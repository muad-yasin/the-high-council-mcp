export function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + '...';
}
