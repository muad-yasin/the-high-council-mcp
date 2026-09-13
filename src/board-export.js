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

/**
 * A run's report.json as one self-contained HTML string: no external
 * assets, no <script>, no server. Never throws on a partial report -
 * missing proposals/debate/signoff just render as empty sections.
 */
export function renderBoardHtml(report) {
  const proposals = report.proposals || [];
  const posts = report.debate?.posts || [];
  const replies = report.debate?.replies || [];
  const signoff = report.signoff || [];

  const proposalsHtml = proposals.length
    ? proposals.map(p => proposalSection(p, posts, replies)).join('\n')
    : '<p>No proposal debate ran this run.</p>';

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
<h2>Proposals</h2>
${proposalsHtml}
</body>
</html>
`;
}
