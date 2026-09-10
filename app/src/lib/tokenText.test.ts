import { sanitizeTokenText, tokenName, tokenSymbol, MAX_TOKEN_NAME } from './tokenText';

// Built from code points rather than pasted, so the test file stays readable
// and a reviewer can see exactly which character is under test.
const RLO = '\u202E'; // right-to-left override — reverses what follows
const LRI = '\u2066'; // left-to-right isolate
const ZWSP = '\u200B';
const ZWJ = '\u200D';
const BOM = '\uFEFF';
const SOFT_HYPHEN = '\u00AD';
const TAG_A = '\u{E0061}'; // tag block: invisible text

describe('sanitizeTokenText', () => {
  it('strips bidi overrides and isolates', () => {
    // The attack: everything after RLO renders reversed, so the stored string
    // and the drawn text are different. Nothing about the length gives it away.
    expect(sanitizeTokenText(`USD${RLO}CBA`, 40)).toBe('USDCBA');
    expect(sanitizeTokenText(`${LRI}Token${RLO}`, 40)).toBe('Token');
  });

  it('strips zero-width padding used to make two tokens look identical', () => {
    expect(sanitizeTokenText(`US${ZWSP}DC`, 40)).toBe('USDC');
    expect(sanitizeTokenText(`US${ZWJ}DC`, 40)).toBe('USDC');
    expect(sanitizeTokenText(`${BOM}USDC`, 40)).toBe('USDC');
    expect(sanitizeTokenText(`US${SOFT_HYPHEN}DC`, 40)).toBe('USDC');
  });

  it('strips the invisible tag block', () => {
    expect(sanitizeTokenText(`USDC${TAG_A}`, 40)).toBe('USDC');
  });

  it('collapses newlines and tabs instead of letting a name leave its row', () => {
    expect(sanitizeTokenText('Two\nLine\tName', 40)).toBe('Two Line Name');
  });

  it('strips emoji and pictographs, including astral ones', () => {
    expect(sanitizeTokenText('www.lamperio.top ✅ claim', 40)).toBe('www.lamperio.top claim');
    expect(sanitizeTokenText('optibase.website \u{1F534} claim airdrop', 40)).toBe(
      'optibase.website claim airdrop',
    );
    expect(sanitizeTokenText('\u{1F9F2}\u{1F381} Reward', 40)).toBe('Reward');
  });

  it('keeps the URL — it tells the reader what they are looking at', () => {
    expect(sanitizeTokenText('www.bopx.club airdrop here!', 40)).toContain('www.bopx.club');
  });

  it('keeps a homoglyph visible rather than folding it to the real symbol', () => {
    // Folding this to "USDT" would render the impersonation AS the thing it
    // impersonates, which is worse than leaving it legible.
    expect(sanitizeTokenText('ÚSDT', 40)).toBe('ÚSDT');
  });

  it('leaves non-Latin scripts and legal marks intact', () => {
    expect(sanitizeTokenText('比特币', 40)).toBe('比特币');
    expect(sanitizeTokenText('Рубль', 40)).toBe('Рубль');
    expect(sanitizeTokenText('Tether™', 40)).toBe('Tether™');
  });

  it('truncates past the cap and marks the cut', () => {
    const out = sanitizeTokenText('A'.repeat(200), MAX_TOKEN_NAME);
    expect(out).toBe(`${'A'.repeat(MAX_TOKEN_NAME)}…`);
  });

  it('survives an absurdly long name without running the regex over all of it', () => {
    expect(sanitizeTokenText('B'.repeat(2_000_000), 40)).toBe(`${'B'.repeat(40)}…`);
  });

  it('returns empty for nothing, junk types and all-invisible input', () => {
    expect(sanitizeTokenText('', 40)).toBe('');
    expect(sanitizeTokenText(undefined, 40)).toBe('');
    expect(sanitizeTokenText(null, 40)).toBe('');
    expect(sanitizeTokenText(123 as unknown as string, 40)).toBe('');
    expect(sanitizeTokenText(`${ZWSP}${RLO}${BOM}`, 40)).toBe('');
  });
});

describe('tokenName / tokenSymbol', () => {
  it('stand in when nothing legible survives', () => {
    expect(tokenName('\u{1F534}\u{1F534}')).toBe('Unknown token');
    expect(tokenSymbol(`${ZWSP}${RLO}`)).toBe('?');
  });

  it('cap a symbol harder than a name', () => {
    expect(tokenSymbol('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKL…');
    expect(tokenName('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKLMNOP');
  });
});
