// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  MercuryNameRegistry — subnames of mercurywallet.eth, entirely on-chain.
//
//  Set as the resolver on mercurywallet.eth, this answers for every name beneath
//  it. Records live in this contract's storage, so once a name is registered it
//  resolves forever with no server, no signing key and nothing to keep running.
//  If every Mercury machine disappeared tomorrow, alice.mercurywallet.eth would
//  still resolve in MetaMask.
//
//  That is the trade being made. The offchain alternative (EIP-3668) gives names
//  away for free but puts an HTTP service on the critical path of every lookup,
//  forever. This costs one transaction per name and then depends on nothing.
//
//  ENSv2 makes this work without a subregistry: a parent's resolver handles its
//  subdomains via ENSIP-10 wildcard resolution, so `alice.mercurywallet.eth`
//  arrives here as resolve(name, data) with no per-name registry entry.
//
//  What a name holds:
//    • the 0x address — one key, so this covers Arc, Base, Arbitrum and every
//      other EVM chain at once
//    • the Solana address, and the Bitcoin address, which are different keys
//    • which chain the owner actually watches, as a routing hint
//
//  IMPORTANT: registering a name proves you control an address. It does not
//  prove you are entitled to a word. Anyone can publish anything here, so a
//  sender must always be shown the resolved address before money moves.
// ─────────────────────────────────────────────────────────────────────────────

/// @dev ENSIP-10 wildcard resolution.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory);
}

contract MercuryNameRegistry is IExtendedResolver {
    struct Record {
        /// Who may change this name. Zero means the name is unregistered.
        address owner;
        /// Valid on every EVM chain.
        address evm;
        /// The chain the owner actually watches. A hint, not a different address.
        uint64 prefer;
        string solana;
        string bitcoin;
    }

    /// keccak256(label) -> record. Keyed by hash so the label's length costs
    /// nothing to look up.
    mapping(bytes32 => Record) private _records;

    /// Labels nobody may register, because they read as us.
    mapping(bytes32 => bool) public reserved;

    /// The apex — mercurywallet.eth itself. Once this contract is the resolver,
    /// the 2LD's own records come from here too, and without this the name it
    /// is registered under would resolve to nothing.
    Record private _apex;

    address public owner;

    event Registered(string indexed label, address indexed to, address evm);
    event RecordsChanged(string indexed label, address evm);
    event Transferred(string indexed label, address indexed from, address indexed to);
    event Reserved(string label, bool value);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ── Record selectors ─────────────────────────────────────────────────────
    bytes4 private constant SEL_ADDR = 0x3b3b57de; // addr(bytes32)
    bytes4 private constant SEL_ADDR_COIN = 0xf1cb7e06; // addr(bytes32,uint256)
    bytes4 private constant SEL_TEXT = 0x59d1d43c; // text(bytes32,string)

    uint256 private constant COIN_BTC = 0;
    uint256 private constant COIN_ETH = 60;
    uint256 private constant COIN_SOL = 501;
    /// ENSIP-11: an EVM chain's own coin type is 0x80000000 + chainId.
    uint256 private constant EVM_COIN_BASE = 0x80000000;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /**
     * @notice Claim a name and publish every address in one transaction.
     * @param label     The subname, e.g. "alice" for alice.mercurywallet.eth
     * @param to        Who owns the name afterwards
     * @param evm       The 0x address the name resolves to
     * @param solana    Solana address, or "" to omit
     * @param bitcoin   Bitcoin address, or "" to omit
     * @param prefer    Chain id the owner watches, or 0
     *
     * `to` is a parameter rather than msg.sender so registration can be paid for
     * by somebody else. A wallet whose users hold no L1 gas needs that option,
     * and building it in now costs nothing.
     *
     * One transaction sets the name and all three address families. Splitting
     * them would leave a window where a name resolves on some chains and not
     * others, which is worse than not resolving at all — the sender cannot tell
     * which case they are in.
     */
    function register(
        string calldata label,
        address to,
        address evm,
        string calldata solana,
        string calldata bitcoin,
        uint64 prefer
    ) external {
        bytes32 key = keccak256(bytes(label));
        require(_records[key].owner == address(0), "name taken");
        require(!reserved[key], "name reserved");
        require(_validLabel(bytes(label)), "invalid label");
        require(to != address(0), "zero owner");

        _records[key] = Record(to, evm, prefer, solana, bitcoin);
        emit Registered(label, to, evm);
    }

    /// @notice Update the addresses a name points at.
    function setRecords(
        string calldata label,
        address evm,
        string calldata solana,
        string calldata bitcoin,
        uint64 prefer
    ) external {
        bytes32 key = keccak256(bytes(label));
        Record storage r = _records[key];
        require(r.owner == msg.sender, "not your name");
        r.evm = evm;
        r.solana = solana;
        r.bitcoin = bitcoin;
        r.prefer = prefer;
        emit RecordsChanged(label, evm);
    }

    /// @notice Hand a name to somebody else.
    function transferName(string calldata label, address to) external {
        bytes32 key = keccak256(bytes(label));
        Record storage r = _records[key];
        require(r.owner == msg.sender, "not your name");
        require(to != address(0), "zero owner");
        emit Transferred(label, msg.sender, to);
        r.owner = to;
    }

    function available(string calldata label) external view returns (bool) {
        bytes32 key = keccak256(bytes(label));
        return _records[key].owner == address(0) && !reserved[key] && _validLabel(bytes(label));
    }

    function recordsOf(string calldata label)
        external
        view
        returns (address nameOwner, address evm, string memory solana, string memory bitcoin, uint64 prefer)
    {
        Record storage r = _records[keccak256(bytes(label))];
        return (r.owner, r.evm, r.solana, r.bitcoin, r.prefer);
    }

    // ── Administration ───────────────────────────────────────────────────────

    /// @notice Reserve labels so nobody can register them.
    /// @dev `support.mercurywallet.eth` pointing at a stranger is a phishing
    ///      tool, not a username. Batched because it is done once, at setup.
    function reserve(string[] calldata labels, bool value) external onlyOwner {
        for (uint256 i; i < labels.length; ++i) {
            reserved[keccak256(bytes(labels[i]))] = value;
            emit Reserved(labels[i], value);
        }
    }

    /// @notice Set what mercurywallet.eth itself resolves to.
    function setApex(address evm, string calldata solana, string calldata bitcoin, uint64 prefer)
        external
        onlyOwner
    {
        _apex = Record(owner, evm, prefer, solana, bitcoin);
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "zero owner");
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    // ── Resolution ───────────────────────────────────────────────────────────

    /**
     * @notice Resolve any name at or beneath mercurywallet.eth.
     * @param name DNS-wire-encoded, e.g. 05 "alice" 13 "mercurywallet" 03 "eth" 00
     * @param data The record being asked for
     *
     * Returns an empty answer for an unregistered name rather than reverting.
     * "No such name" is a real answer, and a revert would read to the caller as
     * "the lookup failed" — a different thing, which invites a retry.
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        (bytes32 key, bool isApex, bool ours) = _parse(name);
        if (!ours) return _empty(bytes4(data[:4]));

        Record storage r = isApex ? _apex : _records[key];
        bytes4 selector = bytes4(data[:4]);

        if (selector == SEL_ADDR) {
            return abi.encode(r.evm);
        }

        if (selector == SEL_ADDR_COIN) {
            uint256 coin = abi.decode(data[36:68], (uint256));
            // Coin type 60 and every ENSIP-11 EVM chain are the same key and so
            // the same address. One record genuinely does cover all of them.
            if (coin == COIN_ETH || coin >= EVM_COIN_BASE) {
                return r.evm == address(0)
                    ? abi.encode(bytes(""))
                    : abi.encode(abi.encodePacked(r.evm));
            }
            if (coin == COIN_SOL) return abi.encode(bytes(r.solana));
            if (coin == COIN_BTC) return abi.encode(bytes(r.bitcoin));
            return abi.encode(bytes(""));
        }

        if (selector == SEL_TEXT) {
            // Decode from the start of the ARGUMENTS, not from byte 36. `key`
            // is dynamic, so its head word holds an offset measured from the
            // end of the selector — slicing past it leaves the offset pointing
            // 32 bytes beyond the string it describes.
            (, string memory key_) = abi.decode(data[4:], (bytes32, string));
            if (keccak256(bytes(key_)) == keccak256("mercury.prefer") && r.prefer != 0) {
                return abi.encode(_toString(r.prefer));
            }
            return abi.encode("");
        }

        return _empty(selector);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x9061b923;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /// @dev The empty answer in the shape the caller's selector expects. A
    ///      `bytes`-returning call answered with a bare word decodes as garbage.
    function _empty(bytes4 selector) private pure returns (bytes memory) {
        if (selector == SEL_ADDR) return abi.encode(address(0));
        if (selector == SEL_TEXT) return abi.encode("");
        return abi.encode(bytes(""));
    }

    /**
     * @dev Split a DNS-wire name into "which record set does this ask for".
     *
     * Two labels (mercurywallet.eth) is the apex. Three is one of ours. Anything
     * deeper — a.b.mercurywallet.eth — is NOT a name we issue, and answering it
     * with `b`'s record would resolve a name nobody registered.
     */
    function _parse(bytes calldata name)
        private
        pure
        returns (bytes32 key, bool isApex, bool ours)
    {
        uint256 i;
        uint256 count;
        uint256 firstStart;
        uint256 firstLen;

        while (i < name.length) {
            uint8 len = uint8(name[i]);
            if (len == 0) break;
            if (i + 1 + len > name.length) return (bytes32(0), false, false);
            if (count == 0) {
                firstStart = i + 1;
                firstLen = len;
            }
            unchecked {
                ++count;
                i += 1 + len;
            }
        }

        if (count == 2) return (bytes32(0), true, true);
        if (count != 3) return (bytes32(0), false, false);
        return (keccak256(name[firstStart:firstStart + firstLen]), false, true);
    }

    /**
     * @dev 3–30 chars, a–z 0–9 and inner hyphens.
     *
     * Narrow on purpose. A name system where `аlice` (Cyrillic а) and `alice`
     * are different names is a name system for impersonating people, and a
     * wallet is exactly where that pays off.
     */
    function _validLabel(bytes memory label) private pure returns (bool) {
        uint256 n = label.length;
        if (n < 3 || n > 30) return false;
        if (label[0] == "-" || label[n - 1] == "-") return false;
        for (uint256 i; i < n; ++i) {
            bytes1 ch = label[i];
            bool okChar = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "-";
            if (!okChar) return false;
        }
        return true;
    }

    function _toString(uint64 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint64 tmp = v;
        uint256 digits;
        while (tmp != 0) {
            ++digits;
            tmp /= 10;
        }
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            buf[--digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buf);
    }
}
