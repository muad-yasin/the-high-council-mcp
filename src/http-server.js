#!/usr/bin/env node
// relay as a network service: trigger-service (sower-industries.de's order pipeline) calling a
// deployed relay instance over HTTPS, since Fly.io machines don't share a filesystem the way a
// local sibling-checkout does. Blocking request/response, not detached-and-polled like
// src/mcp/server.js's tools - this mirrors trigger-service's own existing jobs/start-run.js and
// jobs/resume-harness.js exactly (a real chain run/resume already blocks the buyer's own HTTP
// request today; this doesn't change that shape, only moves where the child process runs).
//
// 2026-09-09: built under an explicit author override of the 2026-09-08 scope-gate KILL-DESCOPE
// verdict on relay productionization (sower-industries/Docs/working-agreements-scars.md carries
// the original verdict; sower-industries/PLAN.md's Parking lot section names the four defects this
// build addresses: wrong dependency facts (fixed below - see requiredEnvForChain(), derived from
// a chain's own seats table rather than guessed), no crash-recovery/idempotency (the idempotency
// store below - disk-persisted at idemDir, its own volume in production, same as runs/), no budget
// guard on the endpoint (dailyUsage() below, a backstop behind trigger-service's own
// MAX_USD_PER_DAY check - this is defense in depth, not the primary guard), and a missed reuse of
// relay's own MCP server (src/mcp/server.js's run-state functions - runSummary/waiting/safeRun -
// are the same disk-as-source-of-truth model this file uses; not literally shared code, since the
// MCP server's detached-and-polled execution model and this file's blocking one are genuinely
// different shapes, but the same conventions: a run's true state always comes from its runs/<id>/
// folder on disk, never from in-memory state that a restart would lose).
import express from 'express';
import crypto from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The only chain trigger-service actually starts (jobs/start-run.js's own DEFAULT_CHAIN,
// 'plan-auto') - read directly from that chain's own seats table rather than assumed, so this list
// can't drift from the chain config the way the original scope-gated spec's provider list did.
// Every other chain this repo can run is out of scope for this endpoint on purpose - trigger-
// service's own RELAY_CHAIN env var (start-run.js) could in principle name a different chain, in
// which case its provider keys would also need to be Fly secrets here; this constant is a
// documented default, not a hard runtime restriction.
export function requiredEnvForChain(chainName, chainsDir = join(root, 'chains')) {
  const configPath = join(chainsDir, `${chainName}.json`);
  if (!existsSync(configPath)) return [];
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const providers = new Set();
  const seats = config.seats || {};
  for (const [key, seat] of Object.entries(seats)) {
    if (key === 'critics') {
      for (const critic of seat) providers.add(critic.provider);
    } else if (seat?.provider) {
      providers.add(seat.provider);
    }
  }
  const KEY_BY_PROVIDER = {
    anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY',
    mistral: 'MISTRAL_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
    groq: 'GROQ_API_KEY', cohere: 'COHERE_API_KEY', openrouter: 'OPENROUTER_API_KEY',
    together: 'TOGETHER_API_KEY', zai: 'ZAI_API_KEY',
  };
  return [...providers].map((p) => KEY_BY_PROVIDER[p]).filter(Boolean).sort();
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const safeRunId = (id) => /^[0-9TZ-]+$/.test(id) && existsSync(join(root, 'runs', id));

// Run ids are relay's own timestamp format (src/cli.js: `new Date().toISOString().replace(...)`),
// e.g. `2026-09-08T10-44-43-969Z` - reversible back to a real Date without needing a second,
// separately-maintained timestamp store.
function runIdToDate(runId) {
  const iso = runId.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Defense-in-depth spend guard at this endpoint's own layer - trigger-service's own
 * spend.js/budgetOk() (checked before it ever calls this service) is the primary guard; this one
 * exists because Docs/working-agreements-scars.md's recorded scope-gate verdict named "no budget
 * guard on the newly-exposed endpoint" as a real defect, and an endpoint reachable by anything
 * holding the bearer token should not trust a caller's own pre-check as its only protection.
 * Source of truth is runs/ on disk (each run's own report.json.totals.usd), same
 * disk-not-memory convention as the rest of this file - nothing here is lost on a restart.
 */
export function dailyUsage(runsDir, now = Date.now()) {
  const cutoff = now - 24 * 3600 * 1000;
  let usd = 0;
  let count = 0;
  for (const id of existsSync(runsDir) ? readdirSync(runsDir) : []) {
    const d = runIdToDate(id);
    if (!d || d.getTime() < cutoff) continue;
    count += 1;
    usd += readJson(join(runsDir, id, 'report.json'))?.totals?.usd ?? 0;
  }
  return { usd, count };
}

function runChildForeground({ spawnFn, args, cwd }) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnFn('node', args, { cwd });
    } catch (err) {
      resolvePromise({ code: null, stderr: String(err?.message ?? err) });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolvePromise({ code: null, stderr: stderr + String(err?.message ?? err) }));
    child.on('close', (code) => resolvePromise({ code, stderr }));
  });
}

// Filtered to relay's own run-id shape (src/cli.js: an ISO-8601 timestamp with `:`/`.` swapped for
// `-`, e.g. `2026-09-08T10-44-43-969Z`) - the same pattern src/mcp/server.js's own safeRun() already
// checks. Without this filter, any other new entry appearing under runsDir in the same before/after
// window (this file's own idempotency store, if it ever shared this directory; a future unrelated
// tool writing here) could be mistaken for the run this request just started.
const RUN_ID_PATTERN = /^[0-9TZ-]+$/;
function findNewRunDir(runsDir, before) {
  if (!existsSync(runsDir)) return null;
  return readdirSync(runsDir).find((d) => !before.has(d) && RUN_ID_PATTERN.test(d)) ?? null;
}

// Idempotency store: one JSON file per idempotency key (trigger-service passes its own order id).
// {status:'pending'} while a spawn is in progress; {status:'done', statusCode, body} once resolved,
// replayed verbatim to a retried request instead of spawning a second run for the same order.
// Atomic create via the 'wx' flag - a second concurrent request for the same key gets EEXIST and is
// told to poll, never silently spawns a duplicate.
//
// 2026-09-09: moved off relayRoot's own ephemeral local disk onto its own persistent path
// (idemDir, independent of runsDir - see createRelayHttpServer's own comment on why it isn't
// nested under runs/ itself) once the author asked for the "lost on restart" tradeoff closed -
// same disk-as-source-of-truth durability runs/ already gets from its own Fly volume.
function idempotencyPath(idemDir, key) {
  return join(idemDir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function claimIdempotencyKey(idemDir, key) {
  mkdirSync(idemDir, { recursive: true });
  const path = idempotencyPath(idemDir, key);
  if (existsSync(path)) {
    const existing = readJson(path);
    return { claimed: false, existing };
  }
  try {
    writeFileSync(path, JSON.stringify({ status: 'pending', startedAt: new Date().toISOString() }), { flag: 'wx' });
    return { claimed: true, path };
  } catch (err) {
    if (err.code === 'EEXIST') return { claimed: false, existing: readJson(path) };
    throw err;
  }
}

function resolveIdempotencyKey(path, statusCode, body) {
  writeFileSync(path, JSON.stringify({ status: 'done', statusCode, body, finishedAt: new Date().toISOString() }));
}

/**
 * createRelayHttpServer({ root, token, spawnFn, maxUsdPerDay, maxRunsPerDay, idemDir }) - factory
 * shape matching trigger-service's own createXRouter()/createXRouter() dependency-injection
 * convention (webhooks/stripe.js, jobs/checkpoint.js) so this is testable against a stub spawnFn,
 * no real child process, no real API keys, same pattern as that repo's own 40-test suite.
 *
 * `idemDir` defaults to `<relayRoot>/.idempotency` (local disk, matching every prior default) but
 * is independently overridable - production points it at its own persistent volume, deliberately
 * NOT nested under `runsDir` (`runs/.idempotency/` would durability-wise be simpler - one mount
 * instead of two - but every directory under runs/ is treated as a run by src/mcp/server.js's and
 * src/ui/server.js's own `list_runs`/UI listings, neither of which this file's own idempotency
 * bookkeeping should ever show up in).
 */
export function createRelayHttpServer({
  relayRoot = root,
  token = process.env.RELAY_SERVICE_TOKEN,
  spawnFn = nodeSpawn,
  maxUsdPerDay = Number(process.env.MAX_USD_PER_DAY || 20),
  maxRunsPerDay = Number(process.env.MAX_RUNS_PER_DAY || 5),
  idemDir = process.env.RELAY_IDEMPOTENCY_DIR || join(relayRoot, '.idempotency'),
} = {}) {
  const runsDir = join(relayRoot, 'runs');
  const cliPath = join(relayRoot, 'src', 'cli.js');
  const resumingNow = new Set();

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', spendLast24h: dailyUsage(runsDir) });
  });

  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = token || '';
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    const ok = expected.length > 0
      && providedBuf.length === expectedBuf.length
      && crypto.timingSafeEqual(providedBuf, expectedBuf);
    if (!ok) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.post('/runs', async (req, res) => {
    const { chain, taskContent, idempotencyKey } = req.body ?? {};
    if (typeof chain !== 'string' || typeof taskContent !== 'string' || typeof idempotencyKey !== 'string' || !chain || !taskContent || !idempotencyKey) {
      res.status(400).json({ error: 'malformed_request' });
      return;
    }

    const usage = dailyUsage(runsDir);
    if (usage.usd >= maxUsdPerDay || usage.count >= maxRunsPerDay) {
      res.status(503).json({ error: 'budget_exceeded', reason: usage.usd >= maxUsdPerDay ? 'usd_cap' : 'run_cap', usage });
      return;
    }

    const claim = claimIdempotencyKey(idemDir, idempotencyKey);
    if (!claim.claimed) {
      if (claim.existing?.status === 'done') {
        res.status(claim.existing.statusCode).json(claim.existing.body);
        return;
      }
      res.status(409).json({ error: 'in_progress' });
      return;
    }

    const taskDir = mkdtempSync(join(tmpdir(), 'relay-service-task-'));
    const taskPath = join(taskDir, `${idempotencyKey}.md`);
    writeFileSync(taskPath, taskContent);

    const before = new Set(existsSync(runsDir) ? readdirSync(runsDir) : []);
    const { code, stderr } = await runChildForeground({
      spawnFn, args: [cliPath, '--chain', chain, '--task', taskPath], cwd: relayRoot,
    });

    let statusCode;
    let body;

    if (code === 3) {
      const runId = findNewRunDir(runsDir, before);
      const needsPath = runId ? join(runsDir, runId, 'NEEDS-answers.md') : null;
      if (!runId || !existsSync(needsPath)) {
        statusCode = 500;
        body = { outcome: 'error', reason: 'run_start_failed', runId };
      } else {
        const questionsRaw = readFileSync(join(runsDir, runId, 'questions.md'), 'utf8');
        const parsed = JSON.parse(questionsRaw.slice(questionsRaw.indexOf('{'), questionsRaw.lastIndexOf('}') + 1));
        const questions = (Array.isArray(parsed?.questions) ? parsed.questions : []).map((q) => q.question).filter(Boolean);
        statusCode = 200;
        body = { outcome: 'paused', runId, questions };
      }
    } else if (code === 0) {
      const runId = findNewRunDir(runsDir, before);
      statusCode = 200;
      body = { outcome: 'completed', runId };
    } else {
      statusCode = 500;
      body = { outcome: 'error', reason: 'nonzero_exit', exitCode: code, stderrTail: stderr.slice(-500) };
    }

    resolveIdempotencyKey(claim.path, statusCode, body);
    res.status(statusCode).json(body);
  });

  app.post('/runs/:id/resume', async (req, res) => {
    const { id } = req.params;
    const { answersText } = req.body ?? {};
    if (!safeRunId(id)) {
      res.status(404).json({ error: 'no_such_run' });
      return;
    }
    if (typeof answersText !== 'string' || !answersText) {
      res.status(400).json({ error: 'malformed_request' });
      return;
    }
    if (resumingNow.has(id)) {
      res.status(409).json({ error: 'resume_in_progress' });
      return;
    }
    resumingNow.add(id);

    try {
      const runDir = join(runsDir, id);
      writeFileSync(join(runDir, 'answers.md'), answersText);

      const { code, stderr } = await runChildForeground({
        spawnFn, args: [cliPath, '--resume', join('runs', id)], cwd: relayRoot,
      });

      if (code !== 0) {
        res.status(500).json({ success: false, error: 'nonzero_exit', exitCode: code, stderrTail: stderr.slice(-500) });
        return;
      }

      // Relay never writes a file literally named PLAN.md - it writes deliverable.md. Same
      // copy-if-missing step trigger-service's own resume-harness.js already does today; moved
      // here since this is now where the run folder actually lives.
      const deliverablePath = join(runDir, 'deliverable.md');
      const planPath = join(runDir, 'PLAN.md');
      if (existsSync(deliverablePath) && !existsSync(planPath)) {
        copyFileSync(deliverablePath, planPath);
      }

      const missing = ['PLAN.md', 'BOARD.md', 'HANDOFF.md'].filter((f) => !existsSync(join(runDir, f)));
      if (missing.length > 0) {
        res.status(500).json({ success: false, error: 'missing_output_files', missing });
        return;
      }
      res.status(200).json({ success: true });
    } finally {
      resumingNow.delete(id);
    }
  });

  app.get('/runs/:id/attachments', (req, res) => {
    const { id } = req.params;
    if (!safeRunId(id)) {
      res.status(404).json({ error: 'no_such_run' });
      return;
    }
    const runDir = join(runsDir, id);
    const files = ['PLAN.md', 'BOARD.md', 'HANDOFF.md']
      .filter((f) => existsSync(join(runDir, f)))
      .map((f) => ({ filename: f, content: readFileSync(join(runDir, f), 'utf8') }));
    res.status(200).json({ files });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = Number(process.env.PORT || 8090);
  if (!process.env.RELAY_SERVICE_TOKEN) {
    console.error('RELAY_SERVICE_TOKEN not set - refusing to start (this endpoint holds live LLM provider keys).');
    process.exit(1);
  }
  const app = createRelayHttpServer({});
  app.listen(PORT, () => {
    console.log(`relay http-server listening on :${PORT}`);
    console.log(`required env for plan-auto: ${requiredEnvForChain('plan-auto').join(', ')}`);
  });
}
