// v5 §1 candidate 8: a run's proposals, debate, replies and verdict as one
// self-contained HTML file - no external assets, no template-engine
// dependency, no server. Same "interactivity without JavaScript" discipline
// docs/demo.html already uses: collapsible sections are plain
// <details>/<summary>, inline CSS only.
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function proposalSection(p, posts, replies) {
  const on = posts.filter(x => x.on === p.id);
  const re = replies.filter(r => r.id === p.id);
  const status = p.withdrawn
    ? `WITHDRAWN by ${esc(p.lab)}${p.replaced_by ? ` in favour of ${esc(p.replaced_by)}` : ''}`
    : p.amended ? 'AMENDED by its author after debate' : 'stands';
  const boardItems = on.map(x => `<li>${esc(x.by)} - ${esc(x.stance)}${x.merge_with ? ` with ${esc(x.merge_with)}` : ''}: ${esc(x.text)}</li>`)
    .concat(re.map(r => `<li>${esc(p.lab)} (author) - ${esc(r.action)}: ${esc(r.text)}</li>`))
    .join('\n') || '<li>(no posts)</li>';

  return `<details>
<summary>${esc(p.id)} (${esc(p.lab)}) - ${status}</summary>
<p><strong>Title:</strong> ${esc(p.title)}</p>
<p><strong>Serves:</strong> ${esc(p.serves)}</p>
<p><strong>What:</strong> ${esc(p.what)}</p>
<p><strong>Why:</strong> ${esc(p.why)}</p>
<p><strong>How:</strong> ${esc(p.how)}</p>
<p><strong>Acceptance test:</strong> ${esc(p.acceptance_test)}</p>
<p><strong>Board:</strong></p>
<ul>
${boardItems}
</ul>
</details>`;
}

// Whole alternative architectures (report.json `alternatives`, present only when the chain ran that
// stage). Pre-release audit 2026-09-23 (PreRelease_Audit_contract #1): the HTML board never rendered
// them, so a shared board silently dropped the debate that decided the plan's shape. Same shape and
// the same escaping as a proposal's section.
function alternativeSection(a, posts, replies) {
  const on = posts.filter(x => x.on === a.id);
  const re = replies.filter(r => r.id === a.id);
  const status = a.withdrawn
    ? `WITHDRAWN by ${esc(a.lab)}${a.replaced_by ? ` in favour of ${esc(a.replaced_by)}` : ''}`
    : a.amended ? 'AMENDED by its author after debate' : 'stands';
  const boardItems = on.map(x => `<li>${esc(x.by)} - ${esc(x.stance)}${x.merge_with ? ` with ${esc(x.merge_with)}` : ''}: ${esc(x.text)}</li>`)
    .concat(re.map(r => `<li>${esc(a.lab)} (author) - ${esc(r.action)}: ${esc(r.text)}</li>`))
    .join('\n') || '<li>(no posts)</li>';
  return `<details>
<summary>${esc(a.id)} (${esc(a.lab)}) - ${esc(a.name)} - ${status}</summary>
<p><strong>Shape:</strong> ${esc(a.shape)}</p>
<p><strong>Key trade-offs:</strong> ${esc(a.key_tradeoffs)}</p>
<p><strong>Bad at:</strong> ${esc(a.bad_at)}</p>
<p><strong>Board:</strong></p>
<ul>
${boardItems}
</ul>
</details>`;
}

/**
 * A run's report.json as one self-contained HTML string: no external
 * assets, no <script>, no server. Never throws on a partial report -
 * missing proposals/debate/signoff just render as empty sections.
 */
import { withoutCanary } from './canary.js';

export function renderBoardHtml(report) {
  // Canary posts/replies are an injected probe (canary: true), never part of the board a person
  // reads (pre-release audit 2026-09-23, ProposalsDebateDispute #2: it rendered as a real objection
  // and "(author) - keep: undefined").
  report = withoutCanary(report);
  const proposals = report.proposals || [];
  const posts = report.debate?.posts || [];
  const replies = report.debate?.replies || [];
  const signoff = report.signoff || [];

  const proposalsHtml = proposals.length
    ? proposals.map(p => proposalSection(p, posts, replies)).join('\n')
    : '<p>No proposal debate ran this run.</p>';

  const alt = report.alternatives;
  const alternativesHtml = alt && Array.isArray(alt.items)
    ? `<h2>Alternative architectures</h2>
<p>Every whole architecture a lab proposed before the plan existed, the other labs' posts on it, and the author's reply. The plan's "Decisions" section records which was chosen and why the others lost.</p>
${alt.items.length ? alt.items.map(a => alternativeSection(a, alt.posts || [], alt.replies || [])).join('\n') : '<p>No lab produced an alternative.</p>'}
`
    : '';

  const verdictItems = signoff.map(s =>
    `<li>${esc(s.provider)}: ${s.signedOff === null ? 'abstained' : s.signedOff ? 'signed off' : 'objected'}</li>`).join('\n') || '<li>(no panel signoff recorded)</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Debate board${report.runId ? ` - ${esc(report.runId)}` : ''}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  summary { cursor: pointer; font-weight: 600; margin: 0.5rem 0; }
  details { border: 1px solid #ddd; border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 0.75rem; }
  h1, h2 { border-bottom: 1px solid #eee; padding-bottom: 0.25rem; }
</style>
</head>
<body>
<h1>Debate board${report.runId ? ` - ${esc(report.runId)}` : ''}</h1>
<p>Chain: ${esc(report.chain || 'unknown')}</p>
<h2>Verdict</h2>
<p>${report.passed ? 'PASSED - every lab signed off' : 'OPEN OBJECTIONS'}</p>
<ul>
${verdictItems}
</ul>
${alternativesHtml}<h2>Proposals</h2>
${proposalsHtml}
</body>
</html>
`;
}
