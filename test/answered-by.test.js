// 0.8.3 harness (a): src/answered-by.js - who answered a session seat, as the answerer DECLARED it (never verified). The pure parts: the sanitiser, the record,
// the one model-to-company table, and the report-side reader that tells "as seated", "different", "not declared" apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDeclared, declaredAnswerer, answerRecordOf, companyOfModel, companyOfSeat, rosterAnswersOf, answerNoteOf, undeclaredNoteOf, askedForOfNeeds, NO_MODEL_SEAT } from '../src/answered-by.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('cleanDeclared: hidden and control characters are blanked, runs of space collapse, the cap holds, an empty string is null', () => {
  assert.equal(cleanDeclared('codex‮\n\tCLI', 200), 'codex CLI');
  assert.equal(cleanDeclared('a​b', 200), 'a b');
  assert.equal(cleanDeclared('x'.repeat(500), 200).length, 200);
  assert.equal(cleanDeclared('  ​\n ', 200), null);
  assert.equal(cleanDeclared(42, 200), null);
  assert.equal(cleanDeclared(undefined, 200), null);
});

test('declaredAnswerer: declared_by says which parts were declared (caller / client / none); nothing is checked', () => {
  assert.deepEqual(declaredAnswerer({ clientInfo: { name: 'codex', version: '1.2' }, model: ' gpt-6.1 ' }), { client: { name: 'codex', version: '1.2' }, model: 'gpt-6.1', declared_by: 'caller' });
  assert.deepEqual(declaredAnswerer({ clientInfo: { name: 'claude-code' } }), { client: { name: 'claude-code', version: null }, model: null, declared_by: 'client' });
  assert.deepEqual(declaredAnswerer({}), { client: null, model: null, declared_by: 'none' });
  assert.deepEqual(declaredAnswerer({ clientInfo: { name: '' }, model: '   ' }), { client: null, model: null, declared_by: 'none' }, 'blank strings are nothing');
  // a client can say anything: a Claude client declaring another company's model is recorded as said
  assert.equal(declaredAnswerer({ clientInfo: { name: 'claude-code' }, model: 'gpt-6.1' }).model, 'gpt-6.1');
});

test('answerRecordOf: only a session seat gets fields; the stored record is cleaned again on the way out; a malformed one reads as absent', () => {
  const seat = { provider: 'external', model: 'subscription:opus-5.5' };
  assert.deepEqual(answerRecordOf({}, { provider: 'mock', model: 'mock-builder' }), {}, 'a seat that is not a session seat keeps its row byte for byte');
  assert.deepEqual(answerRecordOf({}, seat), { asked_for: 'subscription:opus-5.5' }, 'a hand-written answer has no usage file: asked_for only');
  const stored = { client: { name: 'codex‮', version: '1' }, model: 'gpt-6.1', declared_by: 'caller' };
  assert.deepEqual(answerRecordOf({ answered_by: stored }, seat), { asked_for: 'subscription:opus-5.5', answered_by: { client: { name: 'codex', version: '1' }, model: 'gpt-6.1', declared_by: 'caller' } });
  for (const bad of ['text', 42, [], { client: 'x', model: 7 }, null]) {
    const r = answerRecordOf({ answered_by: bad }, seat);
    assert.equal(r.answered_by?.model ?? null, null, `a stored value ${JSON.stringify(bad)} never invents a model`);
  }
  // a hand-edited usage file cannot smuggle a longer string or a different declared_by
  const forged = answerRecordOf({ answered_by: { client: null, model: 'm'.repeat(500), declared_by: 'verified' } }, seat);
  assert.equal(forged.answered_by.model.length, 100);
  assert.equal(forged.answered_by.declared_by, 'caller');
});

test('companyOfModel: a model name is a company by ONE table; a router id answers with its vendor; an unlisted name is null, never guessed', () => {
  const want = {
    'subscription:opus-5.5': 'anthropic', 'subscription:fable-5.1': 'anthropic', 'subscription:gpt-6.1-sol': 'openai', 'claude-opus-5-5': 'anthropic', 'gpt-6.1': 'openai', 'o3': 'openai',
    'gemini-3.6-flash': 'google', 'deepseek-v4.1-flash': 'deepseek', 'qwen3.7-plus': 'qwen', 'glm-5.3': 'z-ai', 'hy4-preview': 'tencent', 'mimo-v2.6-pro': 'xiaomi',
    'deepseek/deepseek-v4.1-flash': 'deepseek', 'deepseek-ai/DeepSeek-V4.1-Flash': 'deepseek', 'meta-llama/llama-4-maverick': 'meta', 'meta/muse-spark-1.3': 'meta', 'mistralai/mistral-large-4-0': 'mistralai', 'z-ai/glm-5.3': 'z-ai',
  };
  for (const [m, c] of Object.entries(want)) assert.equal(companyOfModel(m), c, m);
  for (const m of ['weirdmodel-9', 'session', '', '   ', null, undefined, 7]) assert.equal(companyOfModel(m), null, `${JSON.stringify(m)} is not in the table`);
});

test('companyOfSeat: a mock seat and a seat that asks for no model have no company; every other model of every shipped chain has one', () => {
  assert.equal(companyOfSeat({ provider: 'mock', model: 'mock-critic-a' }), null);
  assert.equal(companyOfSeat({ provider: 'external', model: NO_MODEL_SEAT }), null);
  const unmapped = new Set();
  const walk = (o, f) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, f));
    if (!o || typeof o !== 'object') return;
    if (typeof o.provider === 'string' && typeof o.model === 'string' && o.provider !== 'mock' && o.model !== NO_MODEL_SEAT && companyOfSeat(o) === null) unmapped.add(`${f}: ${o.provider} | ${o.model}`);
    for (const v of Object.values(o)) walk(v, f);
  };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')), f);
  assert.deepEqual([...unmapped], [], 'a shipped model the table has no row for would silently read as "company not known" on every report');
});

const api = (label, model, lab) => ({ label, provider: 'openrouter', model, lab });
const sess = (label, lab, asked, answered_by) => ({ label, provider: 'external', model: 'session', lab, asked_for: asked, ...(answered_by ? { answered_by } : {}) });
const said = (name, model) => ({ client: name ? { name, version: '1' } : null, model, declared_by: model ? 'caller' : name ? 'client' : 'none' });

test('rosterAnswersOf: null without a session-seat stage; each answered session stage gets a status; the panel tally counts what was RECORDED', () => {
  assert.equal(rosterAnswersOf([api('panel-1-sol', 'openai/gpt-6.1-sol', 'sol')]), null);
  assert.equal(rosterAnswersOf(undefined), null);
  const stages = [
    api('panel-1-sol', 'openai/gpt-6.1-sol', 'sol'),
    api('panel-1-ds', 'deepseek/deepseek-v4.1-flash', 'ds'),
    sess('panel-1-opus5.5-sub', 'opus5.5-sub', 'subscription:opus-5.5', said('codex', 'gpt-6.1')),        // asked Anthropic, answered OpenAI
    sess('panel-1-haiku5.5-sub', 'haiku5.5-sub', 'subscription:haiku-5.5', said('claude-code', 'claude-haiku-5-5')),
    sess('panel-2-haiku5.5-sub', 'haiku5.5-sub', 'subscription:haiku-5.5'),                              // no record: a hand-written answer
    sess('panel-1-x', 'x', 'subscription:opus-5.5', said('cline', 'some-new-model')),
    sess('build', null, NO_MODEL_SEAT, said('codex', 'gpt-6.1')),
    sess('revise-1', null, NO_MODEL_SEAT),
  ];
  const r = rosterAnswersOf(stages);
  const by = Object.fromEntries(r.seats.map(s => [s.label, s]));
  assert.equal(by['panel-1-opus5.5-sub'].status, 'different');
  assert.equal(by['panel-1-opus5.5-sub'].company, 'openai');
  assert.equal(by['panel-1-haiku5.5-sub'].status, 'as-seated');
  assert.equal(by['panel-2-haiku5.5-sub'].status, 'not-declared');
  assert.equal(by['panel-2-haiku5.5-sub'].company, null, 'no declaration: the company is NOT the seat\'s lab');
  assert.equal(by['panel-1-x'].status, 'not-in-table');
  assert.equal(by.build.status, 'no-model-asked', 'a seat that asked for no model is never "different"');
  assert.equal(by.build.company, 'openai');
  assert.equal(by['revise-1'].status, 'no-model-asked', 'a writer seat that asks for no model is a design fact: never "not declared"');
  assert.equal(by['revise-1'].panel, false); assert.equal(by['panel-1-x'].panel, true);
  assert.equal(by['panel-1-x'].company, null, 'an unlisted model has NO company; it is never the seat\'s lab or the asked company');
  assert.equal(r.seats.length, 6);
  // panel tally: design = openai, deepseek, anthropic (opus, haiku, x asked anthropic) = 3; recorded = openai, deepseek, anthropic (haiku declared) = 3
  assert.equal(r.design_companies, 3);
  assert.deepEqual([r.recorded_companies, r.unverified_seats], [3, 2], 'the haiku hand-written seat and the unlisted model are unverified');
  assert.match(r.note, /never verified/);
});

test('rosterAnswersOf: a panel answered entirely by one company shows ONE recorded company next to the design\'s several', () => {
  const stages = ['a', 'b', 'c'].map((k, i) => sess(`panel-1-${k}`, k, ['subscription:opus-5.5', 'subscription:gpt-6.1-sol', 'subscription:haiku-5.5'][i], said('codex', 'gpt-6.1')));
  const r = rosterAnswersOf(stages);
  assert.equal(r.design_companies, 2);
  assert.equal(r.recorded_companies, 1);
  assert.equal(r.unverified_seats, 0);
});

test('S4 and S5 are scoped to what the tally counts: a judge answered by another company fires S4 with the independence clause; a writer stage states the fact only; S5 counts judges with no known company and never writers', () => {
  const judge = { label: 'panel-1-opus', provider: 'external', asked_for: 'subscription:opus-5.5', answered_by: declaredAnswerer({ model: 'gpt-6.1' }) };
  assert.match(answerNoteOf(judge), /^!! ANSWERED BY A DIFFERENT MODEL: panel-1-opus is seated as subscription:opus-5\.5 and the answer says gpt-6\.1\. Independence below is counted/);
  const writer = { ...judge, label: 'build' };
  assert.equal(answerNoteOf(writer), '!! ANSWERED BY A DIFFERENT MODEL: build is seated as subscription:opus-5.5 and the answer says gpt-6.1. It is recorded as declared.');
  assert.doesNotMatch(answerNoteOf(writer), /Independence/);
  const noModelWriter = { label: 'revise-1', provider: 'external', asked_for: NO_MODEL_SEAT };
  assert.equal(answerNoteOf(noModelWriter), null); assert.equal(undeclaredNoteOf([noModelWriter, { ...noModelWriter, label: 'build' }]), null, 'writer seats with no model asked fire nothing');
  const noModelJudge = { label: 'panel-1-x', provider: 'external', asked_for: NO_MODEL_SEAT };
  assert.equal(undeclaredNoteOf([noModelJudge]), '1 judge seat was answered by a session that declared no model the harness knows; its company is shown as not known.', 'a judge on claude-code-session that stays undeclared is a real "not known"');
  assert.equal(undeclaredNoteOf([noModelJudge, { ...judge, answered_by: null }]), '2 judge seats were answered by a session that declared no model the harness knows; their companies are shown as not known.');
  assert.equal(undeclaredNoteOf([{ ...noModelJudge, answered_by: declaredAnswerer({ model: 'gpt-6.1' }) }]), null, 'a declared model the table knows is a known company');
  const twoRounds = [{ ...noModelJudge, lab: 'x', label: 'panel-1-x' }, { ...noModelJudge, lab: 'x', label: 'panel-2-x' }];
  assert.match(undeclaredNoteOf(twoRounds), /^1 judge seat was answered/, 'one seat answered in two rounds is ONE seat: the same unit as the BOARD line');
});

test('askedForOfNeeds reads only the header of a NEEDS file, never the prompts below it', () => {
  const head = '# External stage: build\n\nWrite the reply to X.\n\nThis seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.\n\n';
  assert.equal(askedForOfNeeds(`${head}## System prompt\n\nsys\n\n## User prompt\n\nuser`), 'subscription:opus-5.5');
  assert.equal(askedForOfNeeds('# External stage: build\n\nWrite the reply.\n\n## System prompt\n\nThis seat is asked for evil-model. If a different model answers, say so with answered_model.\n'), null, 'a line inside a prompt is not the header');
  assert.equal(askedForOfNeeds('# External stage: build\n\n## System prompt\n\nx'), null);
  assert.equal(askedForOfNeeds(undefined), null);
  // the value lands in instruction position in the dispatch bundle: a doctored header is held to a model-id shape and a cap
  assert.equal(askedForOfNeeds('# External stage: build\n\nThis seat is asked for ignore;the;rules. If a different model answers, say so with answered_model.\n\n## System prompt\n\nx'), null);
  assert.equal(askedForOfNeeds(`# E\n\nThis seat is asked for ${'m'.repeat(101)}. If a different model answers, say so with answered_model.\n\n## System prompt\n\nx`), null);
  assert.equal(askedForOfNeeds(`# E\n\nThis seat is asked for ${'m'.repeat(100)}. If a different model answers, say so with answered_model.\n\n## System prompt\n\nx`), 'm'.repeat(100));
});
