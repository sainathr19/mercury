/** Distinct word positions the user must confirm, ascending. */
export function pickChallenge(phrase: string, count = 3): number[] {
  const n = phrase.trim().split(/\s+/).length;
  const chosen = new Set<number>();
  while (chosen.size < Math.min(count, n)) {
    chosen.add(Math.floor(Math.random() * n));
  }
  return [...chosen].sort((a, b) => a - b);
}

export function checkChallenge(phrase: string, indices: number[], answers: string[]): boolean {
  if (indices.length !== answers.length) return false;
  const words = phrase.trim().toLowerCase().split(/\s+/);
  return indices.every((idx, i) => words[idx] === answers[i].trim().toLowerCase());
}
