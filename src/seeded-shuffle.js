// A shuffle that is a pure function of a seed string (mulberry32 over an FNV-1a hash), so a resumed run replays the same order and no Math.random reaches a prompt.
// One copy, used by the relay panel (src/chain.js) and the debate's per-reader order (src/debate-order.js). test/resume-determinism.test.js keeps Math.random out of src/chain.js.
// Origin: the relay panel's order, shuffled from a seed, not from Math.random - bug audit 2026-09-26 #2.
// A relay reviewer is handed the verdicts before it, so the order is part of every later reviewer's
// prompt: a fresh random order on resume changed those prompts, the stage cache read them as stale,
// and every completed panel stage of the round was paid for again. Seeded from the run id and the
// round, the order still differs from round to round (no lab is always the anchor) and a resumed
// run replays the order it had. mulberry32 over an FNV-1a hash of the seed string: small, and
// deterministic across platforms. test/resume-determinism.test.js keeps Math.random out of this file.
export function seededShuffle(list, seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  const next = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
