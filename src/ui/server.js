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

// Drafts in the order they were written: build, revise-1, revise-2, ..., final.
function draftFiles(dir) {
  const names = readdirSync(dir);
  const order = n => n === 'build.md' ? 0 : n.startsWith('revise-') ? 1 + Number(n.match(/\d+/)[0]) : n === 'final.md' ? 900 : -1;
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
  for (const f of files) {
    const m = f.match(/^panel-(\d+)-([a-z0-9]+)\.md$/) || f.match(/^critique-(\d+)\.md$/);
    if (!m) continue;
    const round = m[1];
    const lab = m[2] || 'critic';
    let parsed = null;
    try {
      const t = texts[f];
      const first = t.indexOf('{'), last = t.lastIndexOf('}');
      parsed = JSON.parse(t.slice(first, last + 1));
    } catch { /* unreadable, shown as such */ }
    (panels[round] ||= []).push({ lab, file: f, parsed });
  }
  return {
    id,
    report,
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
// and a run's texts can hold fenced private source. The browser still sends the page's own
// hostname in Host, so only the two names this server is reached by, on its own port, are
// answered: 127.0.0.1:<port> and localhost:<port>. (2026-09-25; the same class as opencode's
// CVE-2026-22812, a local server any web page could reach.) It listens on 127.0.0.1 only, so
// [::1] never reaches it and is not listed.
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const hostAllowed = host => allowedHosts.has(String(host || '').toLowerCase());

const server = createServer((req, res) => {
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (!hostAllowed(req.headers.host)) return send(403, '{"error":"loopback only"}');
  try {
    // Inside the try: a request line the URL parser rejects used to throw out of the handler and
    // stop the viewer (security scan 2026-09-26, THC #8). It is a 400 now.
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return send(400, '{"error":"bad request"}'); }
    if (url.pathname === '/api/runs') return send(200, JSON.stringify(listRuns()));
    const m = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (m) {
      let id;
      try { id = decodeURIComponent(m[1]); } catch { return send(404, '{"error":"no such run"}'); }
      const d = runDetail(id);
      return d ? send(200, JSON.stringify(d)) : send(404, '{"error":"no such run"}');
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[a-z0-9._-]+$/i.test(file)) return send(404, 'not found', 'text/plain');
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
