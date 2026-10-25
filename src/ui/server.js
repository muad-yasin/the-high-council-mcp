#!/usr/bin/env node
// Local viewer for relay runs. Serves the static page and a small JSON API
// over runs/. Nothing is written, nothing leaves the machine.
//
//   npm run ui            -> http://127.0.0.1:8787
//   PORT=9000 npm run ui
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, extname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSections, compareDrafts, parseLedger, words } from './parse.js';
import { RUN_FOLDER } from '../run-status.js';
import { verdictHeadline } from '../verdict-headline.js';
import { createGuard, SECURITY_HEADERS, refusalBody } from './guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// COUNCIL_WORKDIR, as for the MCP server: the directory whose runs/ is shown. Unset, the clone's own.
const runsDir = join(process.env.COUNCIL_WORKDIR ? resolve(process.env.COUNCIL_WORKDIR) : root, 'runs');
const port = Number(process.env.PORT || 8787);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }

function listRuns() {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter(id => runDir(id))
    .sort()
    .reverse()
    .map(id => {
      const report = readJson(join(runsDir, id, 'report.json'));
      const deliverable = readText(join(runsDir, id, 'deliverable.md'));
      const log = readText(join(runsDir, id, 'run.log')) || '';
      const chain = report?.chain || (log.match(/^chain: (\S+)/m) || [])[1] || '?';
      const task = report?.task || (log.match(/^task: +(\S+)/m) || [])[1] || '?';
      return {
        id, chain, task,
        finished: !!report,
        passed: report?.passed ?? null,
        usd: report?.totals?.usd ?? null,
        words: deliverable ? words(deliverable) : null,
        proposals: report?.proposals?.length ?? 0,
      };
    });
}

// Drafts in the order they were written: build, revise-1, revise-2, ..., final. Only the draft
// files themselves: the stage labels are `revise-<N>` and `revise-<N>-full`, and every stage also
// leaves `<label>.usage.json` / `<label>.prompt.json` beside its .md, which are not drafts.
function draftFiles(dir) {
  const names = readdirSync(dir);
  const order = n => {
    if (n === 'build.md') return 0;
    if (n === 'final.md') return Infinity;
    const m = n.match(/^revise-(\d+)(-full)?\.md$/);
    return m ? 1 + Number(m[1]) * 2 + (m[2] ? 1 : 0) : -1;
  };
  return names.filter(n => order(n) >= 0).sort((a, b) => order(a) - order(b));
}

// Security scan 2026-09-26 (THC #2): the id came from the URL, percent-decoded, and was joined onto
// runs/ as it was, so an encoded "/" reached folders outside it. A run id is now the exact shape
// the MCP tools accept (src/run-status.js RUN_FOLDER), and the folder's real path, symlinks
// followed, must be a direct child of runs/. Anything else is "no such run".
function runDir(id) {
  if (typeof id !== 'string' || !RUN_FOLDER.test(id)) return null;
  try {
    const real = realpathSync(join(runsDir, id));
    const rel = relative(realpathSync(runsDir), real);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) return null;
    return statSync(real).isDirectory() ? real : null;
  } catch { return null; }
}

function runDetail(id) {
  const dir = runDir(id);
  if (!dir) return null;
  const report = readJson(join(dir, 'report.json'));
  const files = readdirSync(dir).sort();
  const drafts = draftFiles(dir).map(name => {
    const text = readText(join(dir, name)) || '';
    return { label: name.replace(/\.md$/, ''), name, words: words(text), tree: parseSections(text) };
  });
  const deliverable = readText(join(dir, 'deliverable.md'));
  const texts = {};
  for (const f of files) if (f.endsWith('.md') || f === 'run.log') texts[f] = readText(join(dir, f));
  // Panel verdicts per round, from the saved critic replies.
  const panels = {};
  const stageRecords = new Map(((report || readJson(join(dir, 'report-partial.json')))?.stages || []).filter(x => x && typeof x.label === 'string').map(x => [x.label, x]));
  const liveRows = (readJson(join(dir, 'state.json'))?.seats || []).filter(r => r && typeof r.lab === 'string' && (r.seat === undefined || typeof r.seat === 'string'));
  for (const f of files) {
    // A lab may hold a hyphen or a dot ("deepseek-v4.1-flash"), and a seat of a model repeated on another layer is "<lab>-l<layer>" (lab identity, 20 Okt 2026): the old [a-z0-9] pattern dropped both from the panel view. A re-ask file (-reaskN) is the same seat's second reply, not a row.
    const m = (/-reask\d+\.md$/.test(f) ? null : f.match(/^panel-(\d+)-([a-z0-9][a-z0-9._-]*)\.md$/)) || f.match(/^critique-(\d+)\.md$/);
    if (!m) continue;
    const round = m[1];
    // The lab shown is the bare lab the run RECORDED for that stage (report.json, or report-partial.json for a stopped run), never the seat key in the file name; only a run with neither yet (still going) falls back to the file-name part.
    const st0 = stageRecords.get(f.replace(/\.md$/, ''));
    const st = st0 && typeof st0.lab === 'string' ? { lab: st0.lab, ...(typeof st0.seat === 'string' ? { seat: st0.seat } : {}) } : null;   // report.json is a file anyone's model output can shape: only strings pass
    // A run with no report yet: state.json holds one row per seat (bare lab + `seat`); a file with no row there gets NO lab and the file-name part in `seat` (the seat key is never shown as a lab).
    const live = st ? null : liveRows.find(r => (r.seat ?? r.lab) === m[2]);
    const lab = st?.lab || live?.lab || (m[2] && !st ? '' : 'critic');
    const seatPart = st?.seat || live?.seat || (st || live || !m[2] ? null : m[2]);
    let parsed = null;
    try {
      const t = texts[f];
      const first = t.indexOf('{'), last = t.lastIndexOf('}');
      parsed = JSON.parse(t.slice(first, last + 1));
    } catch { /* unreadable, shown as such */ }
    // ROADMAP 83: the top layer's reply in the pass after a session's early-finish proposal answers a different question (finish now?), not the plan's sign-off: labelled, never hidden
    const es = report?.stop;
    const early = es?.kind === 'early_finish' && String(es.pass) === round && Array.isArray(es.overseer) && es.overseer.includes(lab);
    (panels[round] ||= []).push({ lab, ...(seatPart ? { seat: seatPart } : {}), file: f, parsed, ...(early ? { early: true } : {}) });
  }
  return {
    id,
    report,
    verdict: verdictHeadline(report).words, // how the run passed, or why it is not a pass (null: open objections); the viewer prints it, one source with the board and run_status
    files,
    drafts: drafts.map(d => ({ label: d.label, name: d.name, words: d.words, tree: d.tree })),
    comparison: compareDrafts(drafts),
    ledger: deliverable ? parseLedger(deliverable) : [],
    panels,
    texts,
  };
}

// Binding to 127.0.0.1 keeps other machines out, not other web pages. A page on any site can
// point its own hostname at 127.0.0.1 (DNS rebinding) and then read this API as same-origin -
// and a run's texts can hold fenced private source. The guard (src/ui/guard.js) answers only the two
// names this server is reached by, on its own port (127.0.0.1:<port>, localhost:<port>), refuses a
// foreign Origin, and refuses anything that would change state (this viewer has no such route, so no
// token is configured and the guard fails closed). (2026-09-25; the same class as opencode's
// CVE-2026-22812, a local server any web page could reach.) It listens on 127.0.0.1 only, so [::1]
// never reaches it and is not listed. Every reply, refusals included, carries the security headers
// (CSP with frame-ancestors 'none', nosniff, no-referrer, no-store) and none of them is CORS.
const guard = createGuard({ port });

// Static files by exact name, not "any file next to server.js": the page needs these three and
// nothing else (0.8.0 B11; the old rule served server.js and parse.js to any client).
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };

const server = createServer((req, res) => {
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type });
    res.end(body);
  };
  // Host, Origin and method first, before the URL is parsed: a hostile Host must not reach the parser
  // (or get a different answer from the 403 for a bad line).
  const early = guard.check(req);
  if (!early.ok) return send(early.status, refusalBody);
  try {
    // Inside the try: a request line the URL parser rejects used to throw out of the handler and
    // stop the viewer (security scan 2026-09-26, THC #8). It is a 400 now.
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return send(400, '{"error":"bad request"}'); }
    const verdict = guard.check(req, { api: url.pathname.startsWith('/api/') });
    if (!verdict.ok) return send(verdict.status, refusalBody);
    if (url.pathname === '/api/runs') return send(200, JSON.stringify(listRuns()));
    const m = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (m) {
      let id;
      try { id = decodeURIComponent(m[1]); } catch { return send(404, '{"error":"no such run"}'); }
      const d = runDetail(id);
      return d ? send(200, JSON.stringify(d)) : send(404, '{"error":"no such run"}');
    }
    const file = STATIC[url.pathname];
    if (!file) return send(404, 'not found', 'text/plain');
    const p = join(here, file);
    if (!existsSync(p)) return send(404, 'not found', 'text/plain');
    return send(200, readFileSync(p), MIME[extname(file)] || 'application/octet-stream');
  } catch (err) {
    return send(500, JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`relay viewer: http://127.0.0.1:${port}  (runs from ${runsDir})`);
});
