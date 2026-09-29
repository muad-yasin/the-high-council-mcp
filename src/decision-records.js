// Two derived views of a finished run (0.8.0, roadmap "Debate, criteria, milestones" item 9), both
// read from what report.json already holds, neither stored anywhere else and neither a verdict:
//   cutDespiteSupport   proposals the builder cut although another lab said it supported them
//   disagreementMap     per round, what each lab's review said (signed off / objected / unheard / passed)
// They exist so a person or the UI can see where the plan left the council's support behind, without
// re-reading the debate. Pure, $0, no model call.
import { realDebate } from './canary.js';

/**
 * Proposals whose scope-ledger status is "cut" and that at least one OTHER lab supported in the
 * debate. Each entry names the supporters and any objectors, so a reader can see whether the cut was
 * contested. Ordered by proposal id, numeric-aware. undefined when the run had no proposals or
 * debate: absent means "not applicable", [] means "checked, none".
 */
export function cutDespiteSupport(proposals, debate) {
  if (!Array.isArray(proposals) || !debate || !Array.isArray(debate.posts)) return undefined;
  const posts = realDebate(debate).posts;
  const out = [];
  for (const p of proposals) {
    if (p?.status !== 'cut') continue;
    const on = posts.filter(x => x.on === p.id && x.by !== p.lab);
    const supporters = [...new Set(on.filter(x => x.stance === 'support').map(x => x.by))];
    if (!supporters.length) continue;
    out.push({
      id: p.id, title: p.title ?? null, author_lab: p.lab ?? null,
      supporters,
      objectors: [...new Set(on.filter(x => x.stance === 'object').map(x => x.by))],
      note: typeof p.note === 'string' ? p.note : '',
    });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
}

/**
 * One row per review round from panelVerdicts: each lab's verdict, and the counts. `carried` marks a
 * verdict reused on an unchanged draft (R1), so a round is never read as more heard than it was.
 * undefined when there were no panel verdicts (a run that never reached review).
 */
export function disagreementMap(panelVerdicts) {
  if (!Array.isArray(panelVerdicts) || !panelVerdicts.length) return undefined;
  const rounds = new Map();
  for (const v of panelVerdicts) {
    if (!rounds.has(v.round)) rounds.set(v.round, []);
    rounds.get(v.round).push(v);
  }
  return [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, vs]) => {
    const n = k => vs.filter(v => v.verdict === k).length;
    return {
      round,
      labs: Object.fromEntries(vs.map(v => [v.lab, v.carried ? `${v.verdict} (carried)` : v.verdict])),
      signed_off: n('signed_off'), objected: n('objected'), unheard: n('unheard'), passed: n('passed'),
    };
  });
}
