import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, toHex, recoverAddress, type Hex } from 'viem';
import { namehash, packetToBytes } from 'viem/ens';
import { answerFor, decodeRequest, dnsDecode, encodeSignedAnswer, signAnswer } from './ens.js';
import { checkLabel, claimMessage } from './names.js';

const NODE = namehash('alice.mercurywallet.eth');
const ADDR = [{ name:'addr', type:'function', stateMutability:'view',
  inputs:[{name:'node',type:'bytes32'}], outputs:[{type:'address'}] }] as const;
const COIN = [{ name:'addr', type:'function', stateMutability:'view',
  inputs:[{name:'node',type:'bytes32'},{name:'coinType',type:'uint256'}], outputs:[{type:'bytes'}] }] as const;
const TEXT = [{ name:'text', type:'function', stateMutability:'view',
  inputs:[{name:'node',type:'bytes32'},{name:'key',type:'string'}], outputs:[{type:'string'}] }] as const;
const RESOLVE = [{ name:'resolve', type:'function', stateMutability:'view',
  inputs:[{name:'name',type:'bytes'},{name:'data',type:'bytes'}], outputs:[{type:'bytes'}] }] as const;

const USER = '0x6ba9a2ab805ca80bebf6d51dac85016641aced87';
const SOL = 'So11111111111111111111111111111111111111112';
const RECORDS = { evm: USER, solana: SOL };

const addrCall = (coin: bigint) => encodeFunctionData({ abi: COIN, functionName: 'addr', args: [NODE, coin] });
/** A dynamic `bytes` return is offset, length, then the data. */
const rawBytes = (hex: string): string => {
  const h = hex.slice(2);
  const len = Number(BigInt(`0x${h.slice(64, 128)}`));
  return h.slice(128, 128 + len * 2);
};

describe('dnsDecode', () => {
  test('round-trips a name from wire format', () => {
    assert.equal(dnsDecode(toHex(packetToBytes('alice.mercurywallet.eth'))), 'alice.mercurywallet.eth');
  });
  test('refuses a length that runs off the end', () => {
    // Truncated input must not yield a shorter, plausible-looking name that
    // would be answered for the wrong record set.
    assert.throws(() => dnsDecode('0x05616c69'));
  });
});

describe('decodeRequest', () => {
  test('unwraps resolve(name, data)', () => {
    const inner = encodeFunctionData({ abi: ADDR, functionName: 'addr', args: [NODE] });
    const wrapped = encodeFunctionData({ abi: RESOLVE, functionName: 'resolve',
      args: [toHex(packetToBytes('alice.mercurywallet.eth')), inner] });
    const r = decodeRequest(wrapped);
    assert.equal(r.name, 'alice.mercurywallet.eth');
    assert.equal(r.inner, inner);
  });
  test('rejects anything that is not a resolve call', () => {
    assert.throws(() => decodeRequest('0xdeadbeef'));
  });
});

describe('answerFor', () => {
  test('addr() returns the 0x address', () => {
    const out = answerFor(RECORDS, encodeFunctionData({ abi: ADDR, functionName: 'addr', args: [NODE] }))!;
    assert.equal(`0x${out.slice(-40)}`, USER);
  });

  test('one EVM record answers coin type 60 AND every ENSIP-11 chain', () => {
    // Arc, Base and Arbitrum are the same key and therefore the same address.
    // If this ever stops being true the whole "one name, four networks" claim
    // stops being true with it.
    for (const coin of [60n, 2147488690n /* Arc */, 2147492101n /* Base */, 2147525809n]) {
      assert.equal(`0x${rawBytes(answerFor(RECORDS, addrCall(coin))!)}`, USER, `coin ${coin}`);
    }
  });

  test('Solana comes back as its own text bytes', () => {
    assert.equal(Buffer.from(rawBytes(answerFor(RECORDS, addrCall(501n))!), 'hex').toString('utf8'), SOL);
  });

  test('a record never set answers empty, not zero', () => {
    // Empty means "no Bitcoin address". A zero-filled answer would be an
    // address, and someone would send money to it.
    assert.equal(rawBytes(answerFor(RECORDS, addrCall(0n))!), '');
  });

  test('an unclaimed name resolves to the zero address', () => {
    const out = answerFor({}, encodeFunctionData({ abi: ADDR, functionName: 'addr', args: [NODE] }))!;
    assert.equal(`0x${out.slice(-40)}`, '0x0000000000000000000000000000000000000000');
  });

  test('publishes the chain the user actually watches', () => {
    const call = encodeFunctionData({ abi: TEXT, functionName: 'text', args: [NODE, 'mercury.prefer'] });
    const out = answerFor({ ...RECORDS, prefer: 5042002 }, call)!;
    assert.equal(Buffer.from(rawBytes(out), 'hex').toString('utf8'), '5042002');
  });

  test('refuses a record it does not understand rather than guessing', () => {
    assert.equal(answerFor(RECORDS, '0x12345678'), null);
  });
});

describe('signAnswer', () => {
  const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
  const RESOLVER = '0x00000000000000000000000000000000000abcde' as Hex;
  const request = `0x9061b923${'11'.repeat(32)}` as Hex;
  const result = `0x${'22'.repeat(32)}` as Hex;
  // expires = 1800000000, from a fixed `now`
  const NOW = (1800000000 - 300) * 1000;

  test('packs expires as a uint64 — eight bytes, not a padded word', async () => {
    // This is the whole test. Padding `expires` to 32 bytes still produces a
    // perfectly valid signature; it just recovers to a different address, and
    // the contract rejects it with nothing to explain why. The expected
    // signature below was cross-checked against a live reference gateway whose
    // answers the deployed ENS OffchainResolver accepts.
    const signed = await signAnswer({ privateKey: KEY, resolver: RESOLVER, request, result, now: NOW });
    assert.equal(signed.expires, 1800000000n);
    assert.equal(
      signed.signature,
      '0xfe243d5e5fc3003907df5717d3dffdc66b8545aa6e597922967c0f817e4da84976583b1262a90464a59f6662ea12b57ad77faf111ec142ad467a099650f813661c',
    );
  });

  test('recovers to the signing key', async () => {
    const signed = await signAnswer({ privateKey: KEY, resolver: RESOLVER, request, result, now: NOW });
    assert.equal(
      await recoverAddress({ hash: '0xaf6626ea92262fea9e27f9d5f9dbea6f2ffda60690c877b19d0535e1bdfe81c0', signature: signed.signature }),
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    );
  });

  test('a different request produces a different signature', async () => {
    // Binding the request is what stops one name's answer being replayed as
    // another's.
    const a = await signAnswer({ privateKey: KEY, resolver: RESOLVER, request, result, now: NOW });
    const b = await signAnswer({ privateKey: KEY, resolver: RESOLVER, request: `0x9061b923${'33'.repeat(32)}`, result, now: NOW });
    assert.notEqual(a.signature, b.signature);
  });

  test('encodes to (bytes, uint64, bytes)', async () => {
    const signed = await signAnswer({ privateKey: KEY, resolver: RESOLVER, request, result, now: NOW });
    const encoded = encodeSignedAnswer(signed);
    assert.equal(encoded.slice(0, 2), '0x');
    assert.ok(encoded.includes(signed.signature.slice(2)));
  });
});

describe('checkLabel', () => {
  test('accepts an ordinary name', () => assert.equal(checkLabel('alice').ok, true));
  test('rejects names that read as us', () => {
    // `support.mercurywallet.eth` resolving to a stranger is a phishing tool,
    // not a username.
    for (const l of ['support', 'admin', 'security', 'refunds']) {
      assert.equal(checkLabel(l).ok, false, l);
    }
  });
  test('rejects malformed labels', () => {
    for (const l of ['ab', '-a-', 'Alice', 'a.b', 'a_b', 'x'.repeat(31)]) {
      assert.equal(checkLabel(l).ok, false, l);
    }
  });
});

test('claimMessage covers every record being published', () => {
  // Signing only the label would let the signature be lifted onto a different
  // set of addresses. What is being authorised is where the name POINTS.
  const m = claimMessage({ label: 'alice', parent: 'mercurywallet.eth', evm: USER, solana: SOL, nonce: 42 });
  assert.ok(m.includes('alice.mercurywallet.eth'));
  assert.ok(m.includes(USER));
  assert.ok(m.includes(SOL));
  assert.ok(m.includes('nonce: 42'));
});
