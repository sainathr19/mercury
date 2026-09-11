//! Drawing strings that a stranger chose.
//
// A token's name and symbol are fields in a contract ANYONE can deploy, and
// anyone can push their token into your wallet — no consent asked, no way to
// refuse delivery. So every token name in this app is untrusted input that
// arrived from a stranger, and it gets drawn in the asset list, the activity
// feed, the transaction detail and the send review screen. That last one exists
// precisely so the user can trust what they read before money moves.
//
// The visible abuse is advertising: "www.example.top [check] claim airdrop",
// paid for with a few cents of gas and displayed by us for free. The abuse that
// matters is invisible:
//
//  • BIDI OVERRIDES (U+202E and its family) reorder every glyph after them, so
//    the string a contract stores and the text a person sees are two different
//    things. No length check or substring match notices.
//  • ZERO-WIDTH characters pad a name until two different tokens render
//    identically, and split a word so a filter looking for "USDC" misses a name
//    a human reads as USDC.
//  • CONTROLS and line separators break a name out of its single-line row.
//
// Truncation fixes none of that, so it is stripped before anything is drawn.
//
// Two things are deliberately NOT done here:
//
//  • URLs are KEPT. "www.lamperio.top claim" is informative — it tells the
//    reader exactly what they are looking at. Hiding spam is a filtering
//    decision, made against value and provenance, not a sanitising one.
//  • HOMOGLYPHS are left alone. Folding the accented U in "USDT" written with
//    U+00DA to a plain "U" would make an impersonation harder to spot, not
//    easier: it would render the fake as the real symbol. The answer to a
//    lookalike is to flag it, never to normalise it into looking legitimate.
//
// Every character class below is written with \u escapes, and every character
// named in a comment by its code point, on purpose. Pasting the literal
// characters in would put invisible control codes into this file, where the
// next person to read it could not see what the rule matches — the same trick
// the rule exists to defeat.

/** Cap for a token's long name. Beyond this it is someone using our layout. */
export const MAX_TOKEN_NAME = 40;
/** Cap for a ticker. Real ones are 2–6; this leaves room without leaving a hole. */
export const MAX_TOKEN_SYMBOL = 12;

/**
 * Invisible and format characters.
 *
 *   U+0000–U+001F  C0 controls          U+007F–U+009F  DEL and C1 controls
 *   U+00AD         soft hyphen          U+034F         combining grapheme joiner
 *   U+061C         Arabic letter mark   U+180B–U+180E  Mongolian selectors
 *   U+200B–U+200F  zero-width, LRM/RLM  U+202A–U+202E  bidi embed and override
 *   U+2060–U+2064  word joiner, invisible operators
 *   U+2066–U+206F  bidi isolates and the deprecated format characters
 *   U+FE00–U+FE0F  variation selectors  U+FEFF         BOM / ZWNBSP
 *   U+E0000–U+E007F  the tag block (invisible text, emoji flag tags)
 *
 * Tab and newline become spaces before this runs, so clearing the whole control
 * range cannot eat a legitimate separator.
 */
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

/**
 * Emoji and pictographs.
 *
 *   U+2190–U+21FF  arrows               U+2300–U+23FF  misc technical (clocks)
 *   U+25A0–U+25FF  geometric shapes     U+2600–U+27BF  misc symbols, dingbats
 *   U+2B00–U+2BFF  misc symbols/arrows  U+20E3         enclosing keycap
 *   U+3030 U+303D U+3297 U+3299         stray CJK marks used as emoji
 *   U+1F000–U+1FBFF                     the emoji planes
 *
 * Scripts are untouched — a Chinese, Korean or Cyrillic token name is a real
 * thing and survives intact. U+00A9, U+00AE and U+2122 stay too; a copyright,
 * registered or trademark sign reads as punctuation, not decoration.
 */
const PICTOGRAPHS =
  /[\u2190-\u21FF\u20E3\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF\u3030\u303D\u3297\u3299]|[\u{1F000}-\u{1FBFF}]/gu;

/**
 * One token name or symbol, safe to draw. May return '' — a name made only of
 * emoji has nothing left once the emoji are gone, which is the honest answer.
 */
export function sanitizeTokenText(raw: string | null | undefined, max: number): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  // Sliced FIRST, generously. A megabyte-long name should never meet a regex;
  // the real cap is applied at the end, once stripping has changed the length.
  const cleaned = raw
    .slice(0, max * 8)
    .replace(/\s+/g, ' ') // tabs, newlines, NBSP, Unicode spaces, U+2028/U+2029
    .replace(INVISIBLE, '')
    .replace(PICTOGRAPHS, '')
    .replace(/\s+/g, ' ') // stripping leaves gaps behind
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

/** A token's display name, with a stand-in when nothing legible survives. */
export function tokenName(raw: string | null | undefined): string {
  return sanitizeTokenText(raw, MAX_TOKEN_NAME) || 'Unknown token';
}

/** A token's ticker. '?' is what the graph path already shows for a missing
 *  symbol, so an unreadable one and an absent one look the same. */
export function tokenSymbol(raw: string | null | undefined): string {
  return sanitizeTokenText(raw, MAX_TOKEN_SYMBOL) || '?';
}
