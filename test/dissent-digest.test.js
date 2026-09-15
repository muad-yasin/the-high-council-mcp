// test/dissent-digest.test.js
//
// v6 item E: the dissent digest's derivation/template/write mechanism, offline throughout - no
// model call needed to prove the mechanism works (the one real BYOK call is exercised separately,
// with the mock provider, so this stays a $0 test suite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveDissentSummary,
  renderDigestTemplate,
  generateDigestText,
  readCompletedRun,
  writeDigest,
} from '../src/dissent-digest.js';

function reportWithDisagreement() {
  return {
    outcome: 'no_consensus',
    disagreement_groups: [
      {
        on: 'p1',
        title: 'whether item 4 needs a new script',
        outcome: 'amended',
        posts: [
          { by: 'deepseek', stance: 'object', text: 'item A proposes new test infrastructure' },
          { by: 'glm', stance: 'merge', text: 'fold into item B' },
        ],
      },
    ],
  };
}

function reportWithNoDisagreement() {
  return { outcome: 'consensus', disagreement_groups: [] };
}

test('deriveDissentSummary pulls topics/objections/verdict from disagreement_groups + outcome only', () => {
  const summary = deriveDissentSummary(reportWithDisagreement());
  assert.deepEqual(summary.topics, ['whether item 4 needs a new script']);
  assert.deepEqual(summary.objections, ['deepseek: item A proposes new test infrastructure']);
  assert.equal(summary.verdict, 'no_consensus');
});

test('deriveDissentSummary on a clean signoff yields empty topics/objections, not a crash', () => {
  const summary = deriveDissentSummary(reportWithNoDisagreement());
  assert.deepEqual(summary.topics, []);
  assert.deepEqual(summary.objections, []);
  assert.equal(summary.verdict, 'consensus');
});

test('renderDigestTemplate is the exact fixed template from the plan, no comparative language', () => {
  const summary = deriveDissentSummary(reportWithDisagreement());
  const text = renderDigestTemplate(summary);
  assert.equal(
    text,
    'The panel disagreed on: whether item 4 needs a new script. Objections raised: deepseek: item A proposes new test infrastructure. Final verdict: no_consensus.'
  );
  assert.doesNotMatch(text, /better|outperform|superior|more accurate/i);
});

test('renderDigestTemplate on no-dissent names it plainly rather than an empty list', () => {
  const text = renderDigestTemplate(deriveDissentSummary(reportWithNoDisagreement()));
  assert.match(text, /nothing - every critic signed off with no objections/);
});

test('generateDigestText with no call falls back to the deterministic template', async () => {
  const report = reportWithDisagreement();
  const text = await generateDigestText({ report, call: null });
  assert.equal(text, renderDigestTemplate(deriveDissentSummary(report)));
});

test('generateDigestText uses the mock provider call when given one (offline, $0)', async () => {
  const report = reportWithDisagreement();
  let calledWith = null;
  const call = async (provider, opts) => {
    calledWith = { provider, opts };
    return { text: 'A short mock paragraph about the disagreement.' };
  };
  const text = await generateDigestText({ report, call, provider: 'mock', model: 'mock-ok' });
  assert.equal(text, 'A short mock paragraph about the disagreement.');
  assert.equal(calledWith.provider, 'mock');
  assert.equal(calledWith.opts.model, 'mock-ok');
  assert.match(calledWith.opts.system, /no comparative or/i);
});

test('generateDigestText falls back to the template if the call throws', async () => {
  const report = reportWithDisagreement();
  const call = async () => { throw new Error('provider down'); };
  const text = await generateDigestText({ report, call, provider: 'mock', model: 'mock-provider-down' });
  assert.equal(text, renderDigestTemplate(deriveDissentSummary(report)));
});

test('generateDigestText falls back to the template if the call returns empty text', async () => {
  const report = reportWithDisagreement();
  const call = async () => ({ text: '' });
  const text = await generateDigestText({ report, call, provider: 'mock', model: 'mock-empty' });
  assert.equal(text, renderDigestTemplate(deriveDissentSummary(report)));
});

test('readCompletedRun throws a clear error when report.json is missing (digest cannot run before signoff)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-no-report-'));
  assert.throws(() => readCompletedRun(dir), /no report\.json/);
});

test('digest.md is written strictly after report.json - mtime ordering proves post-signoff generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-mtime-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(reportWithDisagreement()));
  const reportMtime = statSync(join(dir, 'report.json')).mtimeMs;
  await new Promise(r => setTimeout(r, 20));
  const report = readCompletedRun(dir);
  const text = renderDigestTemplate(deriveDissentSummary(report));
  const path = writeDigest(dir, text);
  const digestMtime = statSync(path).mtimeMs;
  assert.ok(digestMtime > reportMtime, 'digest.md mtime must be later than report.json mtime');
  assert.equal(readFileSync(path, 'utf8').trim(), text);
});
