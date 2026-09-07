import { encodeRegister, fullName, labelHash, validateLabel } from './mercuryName';

// A label becomes a name people read off a screen and type into a send field, so
// the rules exist to stop lookalikes rather than to be tidy. These mirror the
// contract's own check — the contract is authoritative, this only saves gas on
// a mistake the user can see before paying for it.
describe('validateLabel', () => {
  test.each(['alice', 'bob-2', 'a1b', 'x'.repeat(30)])('accepts %s', (label) => {
    expect(validateLabel(label)).toBeNull();
  });

  test.each([
    ['ab', 'too short'],
    ['x'.repeat(31), 'too long'],
    ['-alice', 'leading hyphen'],
    ['alice-', 'trailing hyphen'],
    ['Alice', 'uppercase'],
    ['al ice', 'space'],
    ['alice.eth', 'a dot would claim a different name'],
    ['аlice', 'Cyrillic а — reads as ASCII, resolves elsewhere'],
    ['alice_1', 'underscore'],
  ])('rejects %s (%s)', (label) => {
    expect(validateLabel(label)).not.toBeNull();
  });
});

test('fullName appends the parent', () => {
  expect(fullName('alice')).toBe('alice.mercurywallet.eth');
});

// The wallet has no ABI encoder, so `register` is assembled by hand: six head
// words of which three are offsets into a tail. A wrong offset does not revert —
// it registers a name nobody asked for, pointing somewhere nobody chose. Pinned
// against viem's encoder byte for byte.
describe('encodeRegister', () => {
  const ADDR = '0x6BA9A2Ab805ca80BEBf6D51daC85016641aCeD87';

  test('matches viem exactly, with every field populated', () => {
    expect(
      encodeRegister({
        label: 'alice',
        to: ADDR,
        evm: ADDR,
        solana: 'So11111111111111111111111111111111111111112',
        bitcoin: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        prefer: 5042002n,
      }),
    ).toBe(
      '0xfd3b28e000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000006ba9a2ab805ca80bebf6d51dac85016641aced870000000000000000000000006ba9a2ab805ca80bebf6d51dac85016641aced870000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000004cef520000000000000000000000000000000000000000000000000000000000000005616c696365000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b536f3131313131313131313131313131313131313131313131313131313131313131313131313131313132000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a62633171617230737272723778666b7679356c3634336c79646e77397265353967747a7a7766356d647100000000000000000000000000000000000000000000',
    );
  });

  test('empty strings still get correct offsets', () => {
    // The common case: a wallet publishing only its 0x address. An empty string
    // occupies a length word and no data, which shifts every later offset.
    const encoded = encodeRegister({
      label: 'bob', to: ADDR, evm: ADDR, solana: '', bitcoin: '', prefer: 0n,
    });
    const w = (i: number) => encoded.slice(10 + i * 64, 10 + (i + 1) * 64);
    // Offsets confirmed against viem for this exact input.
    expect(BigInt('0x' + w(0))).toBe(192n); // label, at the end of the 6-word head
    expect(BigInt('0x' + w(3))).toBe(256n); // solana, after label's length + one data word
    expect(BigInt('0x' + w(4))).toBe(288n); // bitcoin, after solana's lone length word
    expect(BigInt('0x' + w(5))).toBe(0n); // prefer
  });

  test('a label longer than one word does not corrupt the offsets', () => {
    const label = 'a'.repeat(40);
    const encoded = encodeRegister({
      label, to: ADDR, evm: ADDR, solana: 'x', bitcoin: '', prefer: 1n,
    });
    const w = (i: number) => BigInt('0x' + encoded.slice(10 + i * 64, 10 + (i + 1) * 64));
    // label tail = 32 (length) + 64 (two padded data words) = 96. Confirmed
    // against viem, which gives labelAt=192 solanaAt=288 for this input.
    expect(w(3) - w(0)).toBe(96n);
    expect(w(4)).toBe(352n);
  });
});

// The `reserved` lookup is keyed by keccak256(label). A wrong hash does not
// error — it reports every name as unreserved, so `support.mercurywallet.eth`
// would look claimable right up until the transaction reverts.
test('labelHash matches the contract mapping key', () => {
  expect(labelHash('support')).toBe(
    '05ed8e412f03a3e829aaa34f3b5d303588af0b61c223dec800945749682d4f73',
  );
});
