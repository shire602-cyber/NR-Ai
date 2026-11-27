// Plain-JS twin of tests/helpers/dates.ts for the .mjs e2e/integration scripts (node cannot import
// the TypeScript helper). tests/unit/dubai-business-date.test.ts pins it to `uaeToday`.
const UAE_OFFSET_MS = 4 * 3_600_000;
export const dubaiIso = (d = new Date()) =>
  new Date(d.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);
export const dubaiToday = () => dubaiIso(new Date());
export const dubaiDaysAgo = (n) => dubaiIso(new Date(Date.now() - n * 86_400_000));
export const dubaiInDays = (n) => dubaiDaysAgo(-n);
