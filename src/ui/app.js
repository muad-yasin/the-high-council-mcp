// The viewer's whole client. Fetches JSON from the local server, renders it.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Every value below comes from files on disk that model output and report.json fill, so each one
// is escaped where it is interpolated, numbers included: report.json is a file, not a type system
// (security scan 2026-09-26, THC #7). usd() prints a finite number or nothing.
const usd = n => { const x = typeof n === 'number' ? n : NaN; return Number.isFinite(x) ? `$${x.toFixed(x < 1 ? 4 : 2)}` : ''; };
const pct = (a, b) => { const x = 100 * Number(a) / Number(b); return Number.isFinite(x) ? x.toFixed(1) : '0'; };
let run = null;

async function main() {
  const runs = await (await fetch('/api/runs')).json();
  const sel = $('#runs');
  sel.innerHTML = runs.map(r => `<option value="${esc(r.id)}">${esc(r.id)}  ${esc(r.chain)}  ${esc(r.task.replace(/^tasks\//, ''))}  ${r.finished ? (r.passed ? 'signed off' : 'open') : 'unfinished'}  ${r.words ? esc(r.words) + 'w' : ''}  ${usd(r.usd)}</option>`).join('');
  sel.onchange = () => load(sel.value);
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button, .tab').forEach(e => e.classList.remove('on'));
    b.classList.add('on'); $(`#tab-${b.dataset.tab}`).classList.add('on');
  });
  const wanted = location.hash.slice(1);
  if (runs.length) load(runs.find(r => r.id === wanted)?.id || runs[0].id);
}

async function load(id) {
  $('#runs').value = id; location.hash = id;
  run = await (await fetch(`/api/runs/${encodeURIComponent(id)}`)).json();
  const rep = run.report;
  $('#runmeta').textContent = rep
    ? `${rep.chain} on ${rep.task} - ${rep.passed ? 'every lab signed off' : 'open objections'} - ${usd(rep.totals?.usd)} - ${run.drafts.length} draft(s)`
    : `unfinished or crashed run - ${run.drafts.length} draft(s) on disk`;
  renderOutline(); renderRevisions(); renderProposals(); renderPanel(); renderCost(); renderFiles();
}

// ---- Outline: last draft as a tree with word and volume bars ----
function renderOutline() {
  const box = $('#outline');
  const d = run.drafts[run.drafts.length - 1];
  if (!d) { box.innerHTML = '<p class="hint">No draft in this run.</p>'; $('#reader').textContent = ''; return; }
  const flat = flatten(d.tree);
  const maxW = Math.max(1, ...flat.map(s => s.words));
  const maxV = Math.max(1, ...flat.map(s => s.volume.score));
  const opts = run.drafts.map(x => `<option value="${esc(x.label)}" ${x === d ? 'selected' : ''}>${esc(x.label)} (${esc(x.words)} words)</option>`).join('');
  box.innerHTML = `<div class="small">Draft: <select id="draftpick">${opts}</select> - ${esc(d.words)} words, ${flat.length} sections.
    Gold bar: words. Blue bar: build volume, a heuristic (files, scripts, code blocks, table rows, checklist items named).</div>
    <div class="row l0"><span class="t small">section</span><span class="n small">words</span><span class="small">size / volume</span></div>` +
    flat.map((s, i) => `<div class="row l${esc(s.level)}" data-i="${i}">
      <span class="t" title="${esc(s.path)}">${esc(s.title)}</span>
      <span class="n">${esc(s.words)}</span>
      <span><div class="bar"><i style="width:${pct(s.words, maxW)}%"></i></div><div class="bar vol" style="margin-top:2px"><i style="width:${pct(s.volume.score, maxV)}%"></i></div></span>
    </div>`).join('');
  $('#draftpick').onchange = e => { run.drafts.push(run.drafts.splice(run.drafts.findIndex(x => x.label === e.target.value), 1)[0]); renderOutline(); };
  box.querySelectorAll('.row[data-i]').forEach(r => r.onclick = () => {
    box.querySelectorAll('.row').forEach(x => x.classList.remove('sel')); r.classList.add('sel');
    const s = flat[Number(r.dataset.i)];
    const v = s.volume;
    $('#reader').innerHTML = `<div class="small" style="white-space:normal;font-family:system-ui">${esc(s.path)} - ${esc(s.words)} words (${esc(s.ownWords)} own)
      <br>volume ${esc(v.score)}: ${esc(v.files.length)} file(s), ${esc(v.scripts.length)} script name(s), ${esc(v.codeBlocks)} code block(s), ${esc(v.tableRows)} table row(s), ${esc(v.checklistItems)} checklist item(s), ${esc(v.numbers)} unit-carrying number(s)
      ${v.files.length ? `<br>files: ${v.files.map(esc).join(', ')}` : ''}${v.scripts.length ? `<br>scripts: ${v.scripts.map(esc).join(', ')}` : ''}</div><hr>` + esc(s.text);
  });
}

function flatten(node, out = []) { if (node.level > 0) out.push(node); node.children.forEach(c => flatten(c, out)); return out; }

// ---- Revisions: every section across drafts, with deltas and the objections per round ----
function renderRevisions() {
  const box = $('#revisions');
  const labels = run.drafts.map(d => d.label);
  if (labels.length < 1) { box.innerHTML = '<p class="hint">No drafts.</p>'; return; }
  const rows = run.comparison.map(c => {
    const cells = labels.map((l, i) => {
      const cur = c.per[l]; const prev = i ? c.per[labels[i - 1]] : null;
      if (!cur) return `<td class="n ${prev ? 'gone' : ''}">${prev ? 'gone' : ''}</td>`;
      if (!prev) return `<td class="n ${i ? 'new' : ''}">${esc(cur.words)}${i ? ' new' : ''}</td>`;
      const d = cur.words - prev.words;
      return `<td class="n">${esc(cur.words)} <span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'small'}">${d > 0 ? '+' : ''}${esc(d || '')}</span></td>`;
    }).join('');
    return `<tr><td class="l${esc(c.level)}" style="padding-left:${esc(8 + (Number(c.level) - 1) * 14)}px">${esc(c.title)}</td>${cells}</tr>`;
  }).join('');
  const totals = `<tr><th>whole draft</th>${run.drafts.map(d => `<th class="n">${esc(d.words)}</th>`).join('')}</tr>`;
  const rounds = Object.keys(run.panels).sort((a, b) => a - b).map(r => {
    const items = run.panels[r].flatMap(p => (p.parsed?.failures || []).filter(f => f && f.criterion && !/^(none|n\/?a)$/i.test(f.criterion)).map(f => `<li><b>${esc(p.lab)}</b>: ${esc(f.problem || f.criterion)}</li>`));
    const drove = run.drafts.some(d => d.label === `revise-${r}`) ? `drove revise-${esc(r)}` : 'left open (round cap reached, no further revision)';
    return `<details class="card"><summary>Round ${esc(r)}: ${items.length} objection(s) ${drove}</summary><ul>${items.join('') || '<li class="small">none</li>'}</ul></details>`;
  }).join('');
  box.innerHTML = `<div class="legend">Words per section in each draft. Green and red are the change from the draft before. "new" and "gone" are sections that appeared or vanished. Below: which lab's objections drove each revision.</div>
    <table><thead><tr><th>section</th>${labels.map(l => `<th class="n">${esc(l)}</th>`).join('')}</tr>${totals}</thead><tbody>${rows}</tbody></table>${rounds}`;
}

// ---- Proposals: per lab, with ledger status, scoreboard, and the dropped pool ----
function renderProposals() {
  const box = $('#proposals');
  const props = run.report?.proposals || [];
  if (!props.length) { box.innerHTML = '<p class="hint">This run had no proposal stage.</p>'; return; }
  const ledger = Object.fromEntries(run.ledger.map(l => [l.id, l]));
  const byLab = {};
  for (const p of props) (byLab[p.lab] ||= []).push(p);
  const score = run.report.scoreboard?.labs || [];
  const sb = `<table><thead><tr><th>lab</th><th>model</th><th class="n">proposed</th><th class="n">accepted</th><th class="n">cut</th><th class="n">unaccounted</th><th class="n">built</th></tr></thead><tbody>` +
    score.map(l => `<tr><td>${esc(l.lab)}</td><td class="small">${esc(l.model)}</td><td class="n">${esc(l.proposed)}</td><td class="n">${esc(l.accepted)}</td><td class="n">${esc(l.cut)}</td><td class="n">${esc(l.unaccounted)}</td><td class="n small">${esc(l.built ?? 'after the build')}</td></tr>`).join('') + '</tbody></table>';
  const cards = Object.entries(byLab).map(([lab, list]) => `<div class="card"><h3>${esc(lab)} <span class="small">${esc(list[0].model)}</span></h3>` +
    list.map(p => { const l = ledger[p.id]; const st = l?.status || 'unaccounted';
      return `<details><summary><b>${esc(p.id)}</b> ${esc(p.title)} <span class="tag ${esc(st)}">${esc(st)}</span> <span class="small">${esc(l?.note || '')}</span></summary>
        <div class="small">serves: ${esc(p.serves)}</div><p>${esc(p.what)}</p><p><i>${esc(p.why)}</i></p><p>${esc(p.how)}</p><p class="small">test: ${esc(p.acceptance_test)}</p></details>`; }).join('') + '</div>').join('');
  const pool = run.texts['proposals-pool.md'] ? `<details class="card"><summary>Full pool, including dropped attempts (proposals-pool.md)</summary><pre class="reader">${esc(run.texts['proposals-pool.md'])}</pre></details>` : '';
  box.innerHTML = `<div class="legend">Scoreboard from the plan's own scope ledger. "built" is filled by a human after a build session.</div>${sb}${cards}${pool}`;
}

// ---- Panel: verdicts per round per lab ----
function renderPanel() {
  const box = $('#panel');
  const rounds = Object.keys(run.panels).sort((a, b) => a - b);
  if (!rounds.length) { box.innerHTML = '<p class="hint">No critic replies on disk.</p>'; return; }
  const crit = run.report?.criteria || [];
  box.innerHTML = (crit.length ? `<div class="card"><h3>Acceptance criteria</h3><ol>${crit.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>` : '') +
    rounds.map(r => `<div class="card"><h3>Round ${esc(r)}</h3>` + run.panels[r].map(p => {
      if (!p.parsed) return `<div><b>${esc(p.lab)}</b> <span class="tag abs">unreadable</span> <span class="small">${esc(p.file)}</span></div>`;
      const fails = (p.parsed.failures || []).filter(f => f && f.criterion && !/^(none|n\/?a)$/i.test(f.criterion));
      return `<details><summary><b>${esc(p.lab)}</b> <span class="tag ${fails.length ? 'bad' : 'ok'}">${fails.length ? esc(fails.length) + ' objection(s)' : 'signed off'}</span> <span class="small">${esc(p.parsed.verdict_line || '')}</span></summary>
        <table><thead><tr><th>criterion</th><th>verdict</th><th>evidence</th></tr></thead><tbody>${(p.parsed.criteria || []).map(c => `<tr><td>${esc(c.criterion)}</td><td class="${/fail/i.test(c.verdict) ? 'down' : 'up'}">${esc(c.verdict)}</td><td class="small">${esc(c.evidence)}</td></tr>`).join('')}</tbody></table></details>`;
    }).join('') + '</div>').join('');
}

// ---- Cost: per stage ----
function renderCost() {
  const box = $('#cost');
  const st = run.report?.stages || [];
  if (!st.length) { box.innerHTML = '<p class="hint">No report.json yet (run unfinished).</p>'; return; }
  const byProv = {};
  for (const s of st) { const k = `${s.provider}/${s.model}`; byProv[k] = (byProv[k] || 0) + (Number.isFinite(s.usd) ? s.usd : 0); }
  box.innerHTML = `<div class="grid2"><div class="card"><h3>By seat</h3><table>${Object.entries(byProv).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${usd(v)}</td></tr>`).join('')}<tr><th>total</th><th class="n">${usd(run.report.totals.usd)}</th></tr></table></div>
    <div class="card"><h3>By stage</h3><table><thead><tr><th>stage</th><th>seat</th><th class="n">in</th><th class="n">out</th><th class="n">thinking</th><th class="n">usd</th><th class="n">s</th></tr></thead><tbody>${st.map(s => `<tr><td>${esc(s.label)}</td><td class="small">${esc(s.provider)}/${esc(s.model)}</td><td class="n">${esc(s.usage?.input ?? '')}</td><td class="n">${esc(s.usage?.output ?? '')}</td><td class="n">${esc(s.usage?.thinking || '')}</td><td class="n">${usd(s.usd)}</td><td class="n">${Number.isFinite(s.ms) ? (s.ms / 1000).toFixed(0) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---- Files: raw view of anything in the run folder ----
function renderFiles() {
  const list = $('#filelist'), view = $('#fileview');
  const names = Object.keys(run.texts);
  list.innerHTML = names.map(n => `<div class="row" data-f="${esc(n)}"><span class="t">${esc(n)}</span><span class="n">${esc((run.texts[n] || '').length)}</span><span></span></div>`).join('');
  list.querySelectorAll('.row').forEach(r => r.onclick = () => { list.querySelectorAll('.row').forEach(x => x.classList.remove('sel')); r.classList.add('sel'); view.textContent = run.texts[r.dataset.f]; });
  view.textContent = run.texts['run.log'] || '';
}

main();
