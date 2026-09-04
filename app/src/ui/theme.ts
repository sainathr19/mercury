export const c = {
  bg: '#0A0A0D',
  surface: '#141419',
  surfaceHi: '#1D1D25',
  line: '#26262F',
  fg: '#FFFFFF',
  fg2: '#A0A0B0',
  fg3: '#6B6B7B',
  accent: '#5B8DEF',
  accentDim: '#22304F',
  good: '#3DD68C',
  bad: '#FF6B6B',
} as const;

export const t = {
  display: { fontSize: 56, fontWeight: '700', letterSpacing: -2, color: c.fg },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6, color: c.fg },
  h2: { fontSize: 19, fontWeight: '600', color: c.fg },
  body: { fontSize: 16, color: c.fg },
  sub: { fontSize: 15, color: c.fg2, lineHeight: 22 },
  cap: { fontSize: 13, color: c.fg3 },
  mono: { fontSize: 14, color: c.fg2, fontFamily: 'Courier' },
} as const;

export const sp = (n: number) => n * 8;
export const r = { sm: 10, md: 16, lg: 22, pill: 999 };
