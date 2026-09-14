// test/seat-model-schema.test.js
//
// MLLM Coder v2, IN-2 acceptance test (relay/runs/2026-09-14T17-25-10-314Z/deliverable.md §3/§9):
// "ajv schema test: the three sample shapes validate, the unsupported-shape sample does not."
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'config', 'seat-model-schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

test('shape 1 (plain id) validates', () => {
  const seat = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' };
  assert.ok(validate(seat), JSON.stringify(validate.errors));
});

test('shape 2 (provider-array fallback via extra.models) validates', () => {
  const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', extra: { models: ['openai/gpt-5', 'google/gemini-3.6-flash'] } };
  assert.ok(validate(seat), JSON.stringify(validate.errors));
});

test('shape 3 (routing-param route via a router slug + extra.plugins) validates', () => {
  const seat = { provider: 'openrouter', model: 'openrouter/pareto-code', extra: { plugins: [{ id: 'pareto-router', min_coding_score: 0.8 }] } };
  assert.ok(validate(seat), JSON.stringify(validate.errors));
});

test('unsupported shape: `model` as a real array (not a string) does NOT validate - this is the exact gotcha IN-1 found the adapter has no safety net for', () => {
  const seat = { provider: 'openrouter', model: ['a/model', 'b/model'] };
  assert.equal(validate(seat), false);
  assert.ok(validate.errors.some(e => e.instancePath === '/model'));
});

test('every seat in chains/coder-gate-v2.json validates against the schema', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'coder-gate-v2.json'), 'utf8'));
  const seats = [cfg.seats.criteria, cfg.seats.skeleton, cfg.seats.builder, ...cfg.seats.proposers, ...cfg.seats.critics].filter(Boolean);
  for (const seat of seats) {
    if (seat.provider === 'external') continue; // no `model` routing shape applies to an external seat
    assert.ok(validate(seat), `${seat.provider}/${seat.model}: ${JSON.stringify(validate.errors)}`);
  }
});
