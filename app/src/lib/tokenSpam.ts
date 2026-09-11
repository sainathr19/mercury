//! Which holdings are worth showing.
//
// Anyone can push an ERC-20 into any address — no consent, no way to refuse
// delivery — so a wallet's token list is partly written by strangers. Spammers
// deploy a worthless token whose NAME is advertising ("www.example.top claim
// airdrop"), mass-airdrop it, and get their copy displayed by every wallet that
// lists holdings. The lure is a drainer: the site asks for a signature that is
// really an approval on something the user actually owns.
//
// The test here is PROVENANCE, not the name. A row reaches the app exactly three
// ways — it is in our curated registry, the user added it by hand, or the Token
// API answered "you hold this" — and only the third is a stranger's choice, so
// only the third is a candidate. Name heuristics were the obvious alternative
// and they are worse:
//
//  • They miss the ones that read as ordinary tokens. Two rows in the reported
//    list were "Royal Cat" and "OpenAI" — no URL, no emoji, nothing to match.
//  • They eventually mislabel something real. A legitimate token is free to be
//    called "Rewards" or to put its own domain in its name.
//
// The value floor is the safety brake, and it is the important half: an asset
// WORTH money is never hidden, whatever its provenance and whatever it is
// called. Hiding money would be a far worse bug than showing spam.

/**
 * Below this, in the user's own currency, a discovered token is treated as
 * spam. A cent is high enough to catch dust and low enough that anything a
 * person would notice missing stays on screen.
 */
export const SPAM_VALUE_FLOOR = 0.01;

/**
 * Whether a holding is spam we should hide by default.
 *
 * Deliberately NOT a judgement about the token — it is a judgement about
 * whether this row is worth the user's attention. Recovering a false positive
 * has to stay possible; see `tokenPrefsStore.allow`.
 */
export function isLikelySpam(asset: { discovered?: boolean }, usdValue: number): boolean {
  // Registry tokens and hand-added ones are never hidden, at any value.
  if (!asset.discovered) return false;
  // Written this way round so a NaN value (a broken price feed) counts as
  // below the floor rather than silently passing the comparison.
  return !(usdValue >= SPAM_VALUE_FLOOR);
}
