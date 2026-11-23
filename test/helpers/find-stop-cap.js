// Finds a spending limit at which the REAL CLI stops a run in a named phase (the stop file's `phase`: before, loop or after). The stop point moves with the cap, and a higher cap never stops a run EARLIER, so the search is: a fixed grid first, then, at each place where the grid goes from a stop to a run that did not stop, a bisection between the two caps. A narrow window (the stop after the review rounds can be a few cents wide) is found by the search, not by the luck of the grid.
// `attempt(cap)` runs the workspace once with that cap and returns { status, phase, w }. Returns { a, cap, tried }: `a` is the attempt that stopped in the phase (null when none did) and `tried` is every cap that was run, for the failure message.
export function findStopCap({ phase, caps, attempt, steps = 18 }) {
  const tried = []; const seen = [];
  const one = cap => { const a = attempt(String(cap)); tried.push(`${cap}: exit ${a.status}, phase ${a.status === 4 ? a.phase ?? '-' : '-'}`); seen.push({ cap: Number(cap), a }); return a; };
  const hit = a => a.status === 4 && a.phase === phase;
  for (const cap of caps) { const a = one(cap); if (hit(a)) return { a, cap, tried }; }
  const grid = [...seen].sort((x, y) => x.cap - y.cap);
  for (let i = 1; i < grid.length; i++) {
    if (!(grid[i - 1].a.status === 4 && grid[i].a.status !== 4)) continue;
    let lo = grid[i - 1].cap; let hi = grid[i].cap;
    for (let k = 0; k < steps; k++) {
      const mid = Number(((lo + hi) / 2).toFixed(6));
      if (!(mid > lo && mid < hi)) break;
      const a = one(mid);
      if (hit(a)) return { a, cap: mid, tried };
      if (a.status === 4) lo = mid; else hi = mid;
    }
  }
  return { a: null, cap: null, tried };
}
