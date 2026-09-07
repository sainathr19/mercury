import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recoverAddress, hashMessage, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { claimMessage, normalizeSignature } from './sponsor.js';

const USER = '0x6ba9a2ab805ca80bebf6d51dac85016641aced87';
const SOL = 'So11111111111111111111111111111111111111112';

describe('claimMessage', () => {
  test('covers every record being published', () => {
    // Signing only the label would let the signature be lifted onto a different
    // set of addresses. What is authorised is where the name POINTS — and we
    // are paying for it, so a forged body must not be able to redirect it.
    const m = claimMessage({ label: 'alice', parent: 'mercurywallet.eth', evm: USER, solana: SOL, nonce: 42 });
    assert.ok(m.includes('alice.mercurywallet.eth'));
    assert.ok(m.includes(USER));
    assert.ok(m.includes(SOL));
    assert.ok(m.includes('nonce: 42'));
  });

  test('changing any published field changes the message', () => {
    const base = { label: 'alice', parent: 'mercurywallet.eth', evm: USER, nonce: 1 };
    const variants = [
      claimMessage(base),
      claimMessage({ ...base, label: 'bob' }),
      claimMessage({ ...base, evm: '0x0000000000000000000000000000000000000001' }),
      claimMessage({ ...base, solana: SOL }),
      claimMessage({ ...base, bitcoin: 'bc1q' }),
      claimMessage({ ...base, nonce: 2 }),
    ];
    assert.equal(new Set(variants).size, variants.length, 'two different claims share a message');
  });

  test('is case-insensitive about the address it binds', () => {
    // The same wallet typed two ways must not produce two different claims.
    assert.equal(
      claimMessage({ label: 'a', parent: 'p', evm: USER, nonce: 1 }),
      claimMessage({ label: 'a', parent: 'p', evm: USER.toUpperCase().replace('0X', '0x'), nonce: 1 }),
    );
  });
});

describe('normalizeSignature', () => {
  const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

  test('leaves a standard 65-byte signature alone', async () => {
    const acct = privateKeyToAccount(KEY);
    const sig = await acct.signMessage({ message: 'hello' });
    assert.equal(normalizeSignature(sig), sig);
  });

  test('expands an EIP-2098 compact signature to something recoverable', async () => {
    // Wallet cores differ here. Rejecting a valid-but-compact signature reads to
    // the user as "your wallet is broken", which is unhelpful and untrue.
    const acct = privateKeyToAccount(KEY);
    const sig = await acct.signMessage({ message: 'hello' });
    const r = sig.slice(2, 66);
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = parseInt(sig.slice(130), 16);
    const vs = (BigInt(v - 27) << 255n) | s;
    const compact = `0x${r}${vs.toString(16).padStart(64, '0')}`;
    assert.equal(
      (await recoverAddress({ hash: hashMessage('hello'), signature: normalizeSignature(compact) as Hex })).toLowerCase(),
      acct.address.toLowerCase(),
    );
  });

  test('lifts a 0/1 recovery byte to 27/28', async () => {
    const acct = privateKeyToAccount(KEY);
    const sig = await acct.signMessage({ message: 'hello' });
    const v = parseInt(sig.slice(130), 16);
    const legacy = `0x${sig.slice(2, 130)}${(v - 27).toString(16).padStart(2, '0')}`;
    assert.equal(
      (await recoverAddress({ hash: hashMessage('hello'), signature: normalizeSignature(legacy) as Hex })).toLowerCase(),
      acct.address.toLowerCase(),
    );
  });

  test('does not invent a signature from garbage', () => {
    assert.equal(normalizeSignature('0xdeadbeef'), '0xdeadbeef');
  });
});
