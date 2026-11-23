// 0.8.4 D38 (plan A T1.4, STEP3 F2; C&C 09 Nov 2026, Q-a = A): the optional `session_reads` of a stage answer. The channel's gate is the recorded words (src/excerpt-channel.js); while they are not recorded the field is
// absent from the tool's schema and a call that carries it has the WHOLE answer refused, nothing written; with them the same answer is accepted and the reads are stored on the usage record for the command to cut, scan
// and record at resume. A bad shape is refused the same way. Offline, $0. The words are test data (test/held-prompts/held-084-a.js), hidden by an override that survives the release apply.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { setHeldForTest } from '../src/held-roles.js';
import { excerptChannelOn, sessionReadsProblems, sessionReadsSchemaFields, EXCERPT_CHANNEL_WORDS } from '../src/excerpt-channel.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { excerptSwitchForSubmit } from '../src/run-status.js';
import { excerptsBlock, sessionReadsField } from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
afterEach(() => { setHeldForTest(null); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-sreads-')); dirs.push(d); return d; };
const WORDS = { excerptsBlock, sessionReadsField };
const HELD = { excerptsBlock: undefined, sessionReadsField: undefined };
const reads = [{ path: 'src/a.js', lines: '3-5', why: 'To check the retry claim.' }, { path: 'README.md', why: 'To read the limits.' }];

test('the gate: both recorded names, and one alone is not enough', () => {
  assert.deepEqual(EXCERPT_CHANNEL_WORDS, ['excerptsBlock', 'sessionReadsField']);
  setHeldForTest(HELD); assert.equal(excerptChannelOn(), false, 'both hidden');
  setHeldForTest({ ...HELD, excerptsBlock }); assert.equal(excerptChannelOn(), false, 'only the block');
  setHeldForTest({ ...HELD, sessionReadsField }); assert.equal(excerptChannelOn(), false, 'only the field');
  setHeldForTest(WORDS); assert.equal(excerptChannelOn(), true, 'both');
});

test('Q-a: the SAME answer is refused whole while the words are held (nothing written) and accepted after the flip, with the reads stored on the usage record', () => {
  const dir = tmp();
  setHeldForTest(HELD);
  assert.throws(() => submitStageAnswer(dir, 'build', 'The plan.', { excerptSwitch: excerptSwitchForSubmit, sessionReads: reads }), /The answer for "build" was not written: session_reads is not available in this version, so nothing was recorded\. Send the answer again without session_reads\./);
  assert.deepEqual(readdirSync(dir), [], 'no answer, no usage record, no claim: no partial record');
  setHeldForTest(WORDS);
  const r = submitStageAnswer(dir, 'build', 'The plan.', { excerptSwitch: excerptSwitchForSubmit, sessionReads: reads });
  assert.equal(r.isDuplicate, false);
  assert.equal(readFileSync(join(dir, 'build.md'), 'utf8'), 'The plan.');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8')).session_reads, [{ path: 'src/a.js', lines: '3-5', why: 'To check the retry claim.' }, { path: 'README.md', lines: null, why: 'To read the limits.' }]);
});

test('an answer without the field is unchanged whatever is recorded: no `session_reads` key on the usage record, an empty list included', () => {
  for (const words of [HELD, WORDS]) {
    setHeldForTest(words);
    const dir = tmp();
    submitStageAnswer(dir, 'build', 'The plan.');
    assert.equal('session_reads' in JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8')), false);
    const dir2 = tmp();
    if (words === WORDS) { submitStageAnswer(dir2, 'build', 'The plan.', { excerptSwitch: excerptSwitchForSubmit, sessionReads: [] }); assert.equal('session_reads' in JSON.parse(readFileSync(join(dir2, 'build.usage.json'), 'utf8')), false, 'an empty list stores nothing'); }
  }
});

test('shape: each problem is named, the whole answer is refused with nothing written, and a good list passes', () => {
  setHeldForTest(WORDS);
  const cases = [
    ['not a list', { path: 'a', why: 'b' }, 'the value is not a list'],
    ['entry not an object', ['src/a.js'], 'entry 1 is not an object'],
    ['no path', [{ why: 'b' }], 'entry 1 has no path'],
    ['blank path', [{ path: '  ', why: 'b' }], 'entry 1 has no path'],
    ['no why', [{ path: 'a' }], 'entry 1 has no why'],
    ['unknown field', [{ path: 'a', why: 'b', text: 'x' }], 'entry 1 names the field "text", which is not path, lines or why'],
    ['bad lines', [{ path: 'a', why: 'b' }, { path: 'a', why: 'b', lines: '5-3' }], 'entry 2 has lines that are not "a-b" or "n"'],
    ['lines not text', [{ path: 'a', why: 'b', lines: 4 }], 'entry 1 has lines that are not "a-b" or "n"'],
  ];
  for (const [name, value, problem] of cases) {
    assert.deepEqual(sessionReadsProblems(value), [problem], name);
    const dir = tmp();
    assert.throws(() => submitStageAnswer(dir, 'build', 'The plan.', { excerptSwitch: excerptSwitchForSubmit, sessionReads: value }), err => err.message.startsWith('The answer for "build" was not written: session_reads is not a list of { path, lines, why }: ') && err.message.includes(problem) && err.message.endsWith('Fix it, then submit the answer again.'), name);
    assert.deepEqual(readdirSync(dir), [], `${name}: nothing written`);
  }
  assert.deepEqual(sessionReadsProblems(reads), []);
  assert.deepEqual(sessionReadsProblems([{ path: 'a', why: 'b', lines: null }, { path: 'a', why: 'b', lines: '7' }, { path: 'a', why: 'b', lines: ' 3 - 5 ' }]), []);
  assert.deepEqual(sessionReadsProblems([{ path: 'a', why: 'b', ['x'.repeat(60)]: 1 }]).length, 1);
});

test('a key-shaped string in a path or a why refuses the whole answer, names the entry, the format and the line, never the value', () => {
  setHeldForTest(WORDS);
  const KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  for (const [where, entry] of [['why', { path: 'src/a.js', why: `Use ${KEY} to read it.` }], ['path', { path: `src/${KEY}.js`, why: 'To read it.' }]]) {
    const dir = tmp();
    assert.throws(() => submitStageAnswer(dir, 'build', 'The plan.', { excerptSwitch: excerptSwitchForSubmit, sessionReads: [reads[0], entry] }), err => /session_reads entry 2 holds 1 key-shaped string/.test(err.message) && /Take them out of it, then submit the answer again\.$/.test(err.message) && !err.message.includes(KEY), where);
    assert.deepEqual(readdirSync(dir), [], `${where}: nothing written`);
  }
});

test('the tool schema: the field is absent while the words are held and present, with the recorded description, after', () => {
  setHeldForTest(HELD);
  assert.deepEqual(sessionReadsSchemaFields(z), {});
  setHeldForTest(WORDS);
  const f = sessionReadsSchemaFields(z);
  assert.deepEqual(Object.keys(f), ['session_reads']);
  assert.equal(f.session_reads.description, sessionReadsField());
  assert.equal(f.session_reads.safeParse(reads).success, true);
  assert.equal(f.session_reads.safeParse(undefined).success, true, 'optional');
  assert.equal(f.session_reads.safeParse([{ path: 'a' }]).success, false);
});

test('source scan: submit_stage builds its schema with sessionReadsSchemaFields and hands the field to submitStageAnswer', () => {
  const src = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
  assert.match(src, /\.\.\.sessionReadsSchemaFields\(z\), \.\.\.excerptAnswersSchemaFields\(z\) \}, async \(\{ run, stage, content, claimed_by, answered_model, session_reads, excerpt_answers \}\)/);   // CHANGED ACCEPTED (D18): OLD the handler took session_reads alone; NEW it takes excerpt_answers beside it. WHY: the second field was added by the text-request path, the first row only pins that session_reads is wired
  assert.match(src, /sessionReads: session_reads, excerptAnswers: excerpt_answers, excerptSwitch: excerptSwitchForSubmit, workDir: work \}\)/);   // CHANGED ACCEPTED (D2, C&C 09 Nov 2026): OLD the call ended at excerptSwitch; NEW it also hands the server's working folder (workDir), so the size check at submit reads only that folder. WHY: run.json is run-folder data. The switch reader is handed in, so src/stage-submission.js reaches no gate module (test/gate-answer.test.js)
});
