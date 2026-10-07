// Seat-written milestones in HANDOFF.md, parsed and linted ($0; 0.8.2 item 6c; owner 6 Oct 2026: "handoff milestones with checks and replan triggers").
// The format is the one the research proposed (Review/Research_0.8.0_Debate_Fable51_2026-09-27.md, "Part B") reduced to what a program can check. The words that ask a seat to write it are a prompt
// change (P10), recorded in src/roles.js (handoffSystem, handoffUserMilestones) by the 0.8.2 re-record: with `handoff_contract.milestones` off (the default; on in the seven shipped planning chains) nothing here runs.
//
//   Status: ready_for_build | needs_evidence | needs_decision | blocked | partial
//   ## Milestones
//   ### M0 - walking skeleton
//   Entry: <checkable preconditions>
//   Work: <ordered items, each pointing at a plan section>
//   Exit:
//   - check: C1, C3 | <the command, tool or hand check> => <the expected result>
//   - discharges: C1, C3        (optional since the check-to-criterion link; when present it is cross-checked)
//   ## Final checklist
//   - [ ] <item>
//
// The lint is the real check (a freeform stage's required_sections is advisory): every locked criterion is NAMED BY a check (owner, 7 Oct 2026: "a criterion counts as discharged only by a check that names it";
// `- check: C1, C3 | <what> => <result>`; the ids before the first `|` count only when they are criterion ids, so a shell pipe in a check is not read as a list), every milestone has at least one check with an
// expected result, a `- discharges:` line (optional now) names only criteria one of ITS checks names, and nothing names a criterion that does not exist. A finding never changes `passed`; it is written to WARNINGS.md, report.json and the "Before you build" section.

export const STATUS_VALUES = Object.freeze(['ready_for_build', 'needs_evidence', 'needs_decision', 'blocked', 'partial']);
const MILESTONES_HEADING = /^##\s+Milestones\s*$/im;
const NEXT_H2 = /^##\s+\S/m;

/** Blank out fenced code blocks (``` ... ```), so an example of the format inside one is neither read as the section nor allowed to end it. */
function maskFences(text) {
  let inside = false;
  return text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { inside = !inside; return ''; }
    return inside ? '' : line;
  }).join('\n');
}

// A criterion id is C followed by 1 to 4 digits (src/contract-lint.js reads the same shape): a longer token (C20261007031500123) is not an id. Audit fix 73-handoff 2: with no cap, a value of 2^53 or more made the
// range loop's `n++` a no-op and the lint never returned (after every stage was paid for; each resume replayed the cached handoff.md into the same loop).
const RANGE = String.raw`C\d{1,4}(?:\s*(?:-|\u2013|to)\s*C?\d{1,4})?`;

/** Criterion ids named in a line: C1, C01 (read as C1), and ranges (C2-C4, C2 to C4). */
function criteriaNamed(line) {
  const ids = [];
  const re = /\bC(\d{1,4})\b(?:\s*(?:-|\u2013|to)\s*C?(\d{1,4})\b)?/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= Math.max(a, Math.min(b, a + 200)); n++) ids.push(`C${n}`);
  }
  return ids;
}

const NAMED = new RegExp(String.raw`^\s*(${RANGE}(?:(?:\s*(?:,|&|and)\s*|\s+)${RANGE})*)\s*\|\s*([\s\S]*)$`);

/** { found, status, milestones: [{ id, title, entry, work, checks: [{ check, expected, criteria: [] }], discharges: [] }], checklist: [], findings: [] } */
export function parseMilestones(text) {
  // Emphasis markers are dropped (a seat may write **Exit:** or - **check:**), code fences are masked, line endings normalised.
  const t = maskFences(String(text ?? '').replace(/\r\n?/g, '\n')).replace(/\*\*|__/g, '');
  // The Status line belongs to the top block, before the first "## " heading: a "Status:" in the prose further down is not the status.
  const top = t.split(/^##\s/m)[0];
  // Audit fix cnc-prompts F3: the status is the FIRST WORD after "Status:" (backticks and emphasis around it, and a note after it, do not make it "no status").
  const status = top.match(/^\s*Status:\s*[`'"*_<\[(]*([A-Za-z_]+)/m)?.[1] ?? null;
  const out = { found: false, status, milestones: [], checklist: [], findings: [] };
  const h = MILESTONES_HEADING.exec(t);
  if (h) {
    out.found = true;
    const after = t.slice(h.index + h[0].length);
    const next = NEXT_H2.exec(after);
    const section = next ? after.slice(0, next.index) : after;
    const blocks = section.split(/^#{3,4}\s+/m).slice(1);
    for (const b of blocks) {
      const [head, ...rest] = b.split('\n');
      const m = head.match(/^(M\d+)\s*[-:\u2013\u2014]?\s*(.*)$/);
      if (!m) continue;
      const ms = { id: m[1], title: m[2].trim(), entry: '', work: '', checks: [], discharges: [] };
      let label = null;
      for (const line of rest) {
        const lab = line.match(/^(Entry|Work|Exit):\s*(.*)$/);
        if (lab) { label = lab[1]; if (label === 'Entry') ms.entry = lab[2]; else if (label === 'Work') ms.work = lab[2]; continue; }
        const bullet = line.match(/^\s*[-*]\s+(check|discharges):\s*(.*)$/i);
        if (bullet) {
          if (bullet[1].toLowerCase() === 'check') {
            const [what, ...exp] = bullet[2].split('=>');
            // "C1, C3 | <what>": the ids before the first "|" name the criteria this check settles, when that part is nothing but criterion ids (and commas, "&", "and", ranges).
            // One way to match every gap (a separator, or spaces alone): the earlier pattern had two adjacent optional `\\s*` and backtracked exponentially on a long unpiped list (audit fix 73-handoff 3).
            const named = what.match(NAMED);
            ms.checks.push({ check: (named ? named[2] : what).trim(), expected: exp.join('=>').trim(), criteria: named ? [...new Set(criteriaNamed(named[1]))] : [] });
          } else ms.discharges.push(...criteriaNamed(bullet[2]));
          continue;
        }
        if (label === 'Entry' && line.trim()) ms.entry += ` ${line.trim()}`;
        if (label === 'Work' && line.trim()) ms.work += ` ${line.trim()}`;
      }
      out.milestones.push(ms);
    }
    const final = t.match(/^##\s+Final checklist\s*$/im);
    if (final) out.checklist = (t.slice(final.index).split(/^##\s+/m)[1] || '').split('\n').map(l => l.match(/^\s*[-*]\s+\[[ xX]\]\s+(.*)$/)?.[1]).filter(Boolean);
  }
  return out;
}

/**
 * The findings for a handoff text against the run's criteria ids (`C1`, `C2`, ...): [{ kind, message }]. [] means the milestones discharge every criterion with a named check.
 * `required` is whether the chain asked for milestones at all; without them the one finding is `no_milestones`.
 */
export function lintMilestones({ text, criteriaIds = [] }) {
  const p = parseMilestones(text);
  const findings = [];
  const add = (kind, message) => findings.push({ kind, message });
  if (!p.found || !p.milestones.length) { add('no_milestones', 'the handoff has no "## Milestones" section with "### M<n> - title" milestones'); return { ...p, findings }; }
  if (!p.status) add('no_status', `the handoff has no "Status:" line (one of ${STATUS_VALUES.join(', ')})`);
  else if (!STATUS_VALUES.includes(p.status)) add('bad_status', `Status "${p.status}" is not one of ${STATUS_VALUES.join(', ')}`);
  // 0.8.2 (item 10h): the seat may say the plan cannot be built as written. That used to sit in report.json and nowhere else; as a finding it reaches WARNINGS.md and the "Before you build" block of HANDOFF.md.
  else if (p.status !== 'ready_for_build') add('status_not_ready', `the handoff's Status is "${p.status}": the seat says ${p.status === 'partial' ? 'only part of the plan can start now' : 'the plan cannot be built as written'} - read "What this is" in HANDOFF.md before building`);
  const seen = new Set();
  for (const m of p.milestones) {
    if (seen.has(m.id)) add('duplicate_milestone', `milestone ${m.id} appears more than once`);
    seen.add(m.id);
    if (!m.checks.length) add('milestone_no_check', `${m.id} has no "- check: <what> => <expected result>" line in its Exit`);
    for (const c of m.checks) if (!c.check || !c.expected) add('check_without_expected', `${m.id} has a check with no expected result ("${(c.check || '(empty)').slice(0, 60)}")`);
    const range = `${criteriaIds[0] || 'none'}..${criteriaIds[criteriaIds.length - 1] || 'none'}`;
    const named = new Set(m.checks.flatMap(c => c.criteria));
    for (const d of new Set([...m.discharges, ...named])) if (!criteriaIds.includes(d)) add('unknown_criterion', `${m.id} names ${d}, which is not one of this run's criteria (${range})`);
    // A "- discharges:" line is a claim; only a check of the same milestone that names the criterion backs it.
    for (const d of m.discharges) if (criteriaIds.includes(d) && !named.has(d)) add('discharge_not_checked', `${m.id} says it discharges ${d}, but none of its checks names ${d} (write "- check: ${d} | <what> => <result>")`);
  }
  // A criterion counts as discharged only by a check that names it.
  const covered = new Set(p.milestones.flatMap(m => m.checks.flatMap(c => c.criteria)));
  for (const id of criteriaIds) if (!covered.has(id)) add('criterion_not_discharged', `${id} is not named by any check (write "- check: ${id} | <what> => <result>" in the milestone that settles it)`);
  return { ...p, findings };
}
