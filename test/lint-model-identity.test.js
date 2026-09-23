// test/lint-model-identity.test.js - 2026-09-23 audit: RunChainStages #5 (the self-review lint
// compared lab strings, so the builder's own model under another lab label passed) and
// Providers #6's load-time half (credentials in a seat's baseUrl).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintChain, modelIdentity } from '../src/chain-lint.js';

const cheap7v2 = () => JSON.parse(readFileSync(new URL('../chains/cheap-7-v2.json', import.meta.url), 'utf8'));
const selfReview = (findings) => findings.filter((f) => f.kind === 'self-review');

test('the audit repro: the builder model on the panel under another lab label is self-review', () => {
  const c = cheap7v2();
  assert.equal(selfReview(lintChain(c, 'cheap-7-v2.json')).length, 0, 'the shipped chain is clean');
  c.seats.critics.push({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'claude-sonnet' });
  const found = selfReview(lintChain(c, 'cheap-7-v2.json'));
  assert.ok(found.some((f) => /seats\.builder runs model/.test(f.message)), JSON.stringify(found));
});

test('the same model reached directly (not via OpenRouter) is still the same model', () => {
  const c = cheap7v2();
  c.seats.critics.push({ provider: 'anthropic', model: 'claude-sonnet-5', lab: 'anthropic-direct' });
  assert.ok(selfReview(lintChain(c, 'cheap-7-v2.json')).length >= 1);
});

test('selfReview: "allowed" still silences it, and a same-lab case reports once, not twice', () => {
  const c = cheap7v2();
  c.seats.critics.push({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'x' });
  c.selfReview = 'allowed';
  assert.equal(selfReview(lintChain(c, 'c.json')).length, 0);
  const d = cheap7v2();
  d.seats.critics.push({ ...d.seats.builder });
  const msgs = selfReview(lintChain(d, 'd.json')).filter((f) => /seats\.builder/.test(f.message));
  assert.equal(msgs.length, 1, JSON.stringify(msgs));
});

test('modelIdentity drops the provider prefix and :variant; mock and external seats never match', () => {
  assert.equal(modelIdentity({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5:beta' }), 'claude-sonnet-5');
  assert.equal(modelIdentity({ provider: 'anthropic', model: 'Claude-Sonnet-5' }), 'claude-sonnet-5');
  assert.equal(modelIdentity({ provider: 'mock', model: 'mock-critic' }), null);
  assert.equal(modelIdentity({ provider: 'external', model: 'claude-code-session' }), null);
});

test('a seat baseUrl with credentials is a lint finding; a plain one is not', () => {
  const c = cheap7v2();
  c.seats.critics[0] = { ...c.seats.critics[0], provider: 'ollama', baseUrl: 'http://admin:pw@box:11434/v1' };
  assert.ok(lintChain(c, 'c.json').some((f) => f.kind === 'baseurl-credentials'));
  c.seats.critics[0].baseUrl = 'http://box:11434/v1';
  assert.ok(!lintChain(c, 'c.json').some((f) => f.kind === 'baseurl-credentials'));
});
