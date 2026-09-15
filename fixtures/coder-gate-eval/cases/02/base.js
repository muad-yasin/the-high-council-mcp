export function average(xs) {
  if (xs.length === 0) return 0;
  const s = xs.reduce((a, b) => a + b, 0);
  return s / xs.length;
}
