export function maxOf(xs) {
  let best = -Infinity;
  for (const x of xs) if (x > best) best = x;
  return best;
}
