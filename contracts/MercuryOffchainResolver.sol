// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  MercuryOffchainResolver — free subnames under mercurywallet.eth.
//
//  Set as the resolver on mercurywallet.eth, this answers for EVERY name beneath
//  it: you.mercurywallet.eth, and a million others, none of which exist on any
//  chain. Creating one costs nobody gas because nothing is written here. That is
//  the entire point — a wallet cannot hand every new user an L1 transaction.
//
//  How it works (EIP-3668 / ENSIP-10): resolve() does not answer. It REVERTS
//  with OffchainLookup, which tells the caller "fetch this from that gateway and
//  hand the reply back to resolveWithProof". Clients that speak CCIP-Read follow
//  the detour; clients that do not simply see no record, which is the correct
//  and safe failure.
//
//  SECURITY: the gateway is not trusted. It is a plain HTTP server that could be
//  compromised, spoofed, or MITM'd, and the answer decides where someone's money
//  goes. So the answer must carry a signature from a key in `signers`, over a
//  digest that binds this resolver, an expiry, the exact request and the exact
//  result. Anything unsigned, mis-signed, replayed onto another request, or past
//  its expiry is rejected on-chain. Compromising the gateway alone changes
//  nothing; the signing key is what matters, and it never needs to be online in
//  the same place the records are stored.
//
//  Deliberately single-file and dependency-free so it can be pasted into Remix
//  and read end to end before it is trusted with anything.
// ─────────────────────────────────────────────────────────────────────────────

/// @dev EIP-3668. The revert IS the protocol here — not an error.
error OffchainLookup(
    address sender,
    string[] urls,
    bytes callData,
    bytes4 callbackFunction,
    bytes extraData
);

/// @dev ENSIP-10 wildcard resolution.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory);
}

/// @dev The shape the gateway implements. Only its selector is used, to build
///      the request; the call itself never happens on-chain.
interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}

contract MercuryOffchainResolver is IExtendedResolver {
    event UrlsChanged(string[] urls);
    event SignerChanged(address indexed signer, bool allowed);
    event OwnershipTransferred(address indexed from, address indexed to);

    address public owner;
    string[] public urls;
    mapping(address => bool) public signers;

    modifier onlyOwner() {
        require(msg.sender == owner, "MercuryResolver: not owner");
        _;
    }

    constructor(string[] memory _urls, address[] memory _signers) {
        owner = msg.sender;
        urls = _urls;
        for (uint256 i; i < _signers.length; ++i) {
            signers[_signers[i]] = true;
            emit SignerChanged(_signers[i], true);
        }
        emit UrlsChanged(_urls);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── Administration ───────────────────────────────────────────────────────
    //
    // The gateway can be moved and its key rotated without redeploying, because
    // an HTTP endpoint is a far more fragile thing than a contract and losing
    // one should not orphan every name issued under it.

    // `memory`, not `calldata`: copying a nested dynamic array (string[]) from
    // calldata straight into storage is not supported by the legacy code
    // generator, and this should compile in Remix with default settings.
    function setUrls(string[] memory _urls) external onlyOwner {
        urls = _urls;
        emit UrlsChanged(_urls);
    }

    function setSigner(address signer, bool allowed) external onlyOwner {
        signers[signer] = allowed;
        emit SignerChanged(signer, allowed);
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "MercuryResolver: zero owner");
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function urlCount() external view returns (uint256) {
        return urls.length;
    }

    // ── Resolution ───────────────────────────────────────────────────────────

    /**
     * @notice Never returns. Reverts with the instruction to ask the gateway.
     * @param name DNS-wire-encoded name, e.g. 03 62 6f 62 … for bob.mercurywallet.eth
     * @param data The resolver call being asked for — addr(node), addr(node,coinType), text(node,key)
     *
     * `callData` is passed as BOTH the gateway request and `extraData`, so the
     * callback can verify the signature against the exact request that produced
     * it. Without that binding a valid signature for one name could be replayed
     * as the answer to another.
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(
            IResolverService.resolve.selector,
            name,
            data
        );
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    /**
     * @notice Verify a gateway response and return the record.
     * @dev Called by the CCIP-Read client after it fetches from the gateway.
     *      Reverts unless the answer is signed by a trusted key, for THIS
     *      resolver, over THIS request, and is not expired.
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(
            response,
            (bytes, uint64, bytes)
        );
        require(expires >= block.timestamp, "MercuryResolver: signature expired");

        address signer = _recover(
            keccak256(
                abi.encodePacked(
                    hex"1900",
                    address(this),
                    expires,
                    keccak256(extraData),
                    keccak256(result)
                )
            ),
            sig
        );
        require(signers[signer], "MercuryResolver: untrusted signer");
        return result;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == 0x01ffc9a7 || // ERC-165
            id == 0x9061b923; // IExtendedResolver (ENSIP-10)
    }

    // ── ECDSA ────────────────────────────────────────────────────────────────

    /**
     * @dev Accepts a 65-byte (r,s,v) signature or a 64-byte EIP-2098 compact one.
     *
     * Rejects the upper half of the curve order. secp256k1 admits two valid `s`
     * values for one signature, so without this check a trusted answer could be
     * mutated into a second, different-looking-but-still-valid signature. That
     * matters wherever a signature is treated as an identifier.
     */
    function _recover(bytes32 digest, bytes memory sig) private pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;

        if (sig.length == 65) {
            assembly {
                r := mload(add(sig, 0x20))
                s := mload(add(sig, 0x40))
                v := byte(0, mload(add(sig, 0x60)))
            }
        } else if (sig.length == 64) {
            bytes32 vs;
            assembly {
                r := mload(add(sig, 0x20))
                vs := mload(add(sig, 0x40))
            }
            s = vs & bytes32(uint256(type(uint256).max >> 1));
            v = uint8(27 + uint256(uint8(vs[0]) >> 7));
        } else {
            revert("MercuryResolver: bad signature length");
        }

        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "MercuryResolver: malleable signature"
        );
        require(v == 27 || v == 28, "MercuryResolver: bad v");

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "MercuryResolver: invalid signature");
        return signer;
    }
}
