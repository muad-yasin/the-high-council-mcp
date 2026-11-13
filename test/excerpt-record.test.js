// 0.8.4 D9 (plan A T5.3, STEP3 F5, A3, F10): the excerpt record, excerpts.jsonl in the run folder (src/excerpt-record.js). One line per excerpt of project text or per request that was declined, left unanswered
// or withheld; the text on the line is the exact text shown, and the prompt block is built from it. The block's words are held (excerptsBlock in test/held-prompts/held-084-a.js) and injected here as the re-record will
// export them. Pure file work in a temp folder, offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHeldForTest } from '../src/held-roles.js';
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { APPROVAL_CHANNELS, EXCERPT_SCHEMA, appendExcerpt, appendExcerpts, buildExcerptEntry, readExcerpts, excerptsReportEntry, excerptBlockFor, excerptProblems, sha256Of, EXCERPTS_FILE } = await import('../src/excerpt-record.js').catch(() => ({}));
import { excerptsBlock, excerptRefusedNotice } from './held-prompts/held-084-a.js';
import { CONTAINER_TAG_START } from '../src/container-text.js';

const dirs = [];
afterEach(() => { setHeldForTest(null); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-excerpts-')); dirs.push(d); return d; };
const FIELDS = ['schema', 'id', 'request_kind', 'requested_by', 'objection_id', 'origin', 'why', 'source_kind', 'path', 'lines', 'text', 'text_sha256', 'file_sha256', 'edited', 'pasted_by', 'advisor', 'advisor_said', 'answered_stage', 'scans', 'approval'];
const AT = '2026-11-04T05:00:00.000Z';
const FILE_LINES = ['one', 'two', 'three', 'four', 'five', 'six'];
const fileBytes = `${FILE_LINES.join('\n')}\n`;
const base = over => ({
  request_kind: 'seat_request', requested_by: 'lab-a', objection_id: 'O-1a2b3c4d', origin: 'panel-1-lab-a', why: 'To judge the retry claim.', source_kind: 'repository_file', path: 'src/a.js', lines: '3-5',
  text: FILE_LINES.slice(2, 5).join('\n'), file_sha256: createHash('sha256').update(fileBytes).digest('hex'), edited: false, pasted_by: 'claude-code-session', advisor: 'consulted', advisor_said: 'Fine to paste.',
  answered_stage: 'revise-1', scans: { key_shape: 'clear', personal_data: 'clear' }, approval: { status: 'not_required', actor: null, channel: null, at: AT, reason: null }, ...over,
});
const declined = (status, over = {}) => base({ text: null, file_sha256: null, answered_stage: status === 'unanswered' ? null : 'revise-1', scans: null, approval: { status, actor: status === 'unanswered' ? null : 'main-session', channel: status === 'unanswered' ? null : 'session', at: AT, reason: 'No need for it.' }, ...over });

test('recording one repository-file excerpt writes ONE line with every field of the table: the text of the lines, its sha256, the sha256 of the whole file (plan A T5 tests, first case)', () => {
  const dir = tmp();
  const e = appendExcerpt(dir, base());
  const lines = readFileSync(join(dir, EXCERPTS_FILE), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const onDisk = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(onDisk), FIELDS);
  assert.deepEqual(onDisk, e);
  assert.equal(onDisk.id, 'E-1');
  assert.equal(onDisk.text, 'three\nfour\nfive');
  assert.equal(onDisk.text_sha256, createHash('sha256').update('three\nfour\nfive').digest('hex'));
  assert.equal(onDisk.file_sha256, createHash('sha256').update(fileBytes).digest('hex'));
  assert.deepEqual(readExcerpts(dir), { entries: [e], lines: 1, problems: [] });
});

test('numbered in the order recorded; a session_read has no requesting seat and appears in the block that follows, under its own heading', () => {
  const dir = tmp();
  appendExcerpt(dir, base());
  const read = appendExcerpt(dir, base({ request_kind: 'session_read', requested_by: null, origin: null, objection_id: null, why: 'To write the answer.', answered_stage: 'revise-1', path: 'src/b.js', lines: '1-2', text: 'one\ntwo' }));
  assert.equal(read.id, 'E-2');
  assert.equal(read.requested_by, null);
  setHeldForTest({ excerptsBlock });
  const block = excerptBlockFor(readExcerpts(dir).entries);
  assert.match(block, /^# Project excerpts added during this run\n\n## E-1: src\/a\.js, lines 3-5 \(repository_file; asked by lab-a for O-1a2b3c4d\)/);
  assert.match(block, /## E-2: src\/b\.js, lines 1-2 \(repository_file; read by the handling session for its answer to revise-1\)\n\nProject text the handling session added during the run, cut by the harness from the file named; it is not the fenced source and was not part of the task at its start\.\n\n```\none\ntwo\n```/);
});

test('every line carries the schema tag like its sibling records (spend-reservations/1): the module writes it, and a line with another tag or none is a problem when read back', () => {
  const dir = tmp();
  const e = appendExcerpt(dir, base());
  assert.equal(e.schema, EXCERPT_SCHEMA);
  assert.equal(EXCERPT_SCHEMA, 'excerpts/1');
  assert.notDeepEqual(excerptProblems({ ...e, schema: 'excerpts/2' }), []);
  const { schema, ...untagged } = e;
  assert.notDeepEqual(excerptProblems(untagged), []);
  writeFileSync(join(dir, EXCERPTS_FILE), `${JSON.stringify({ ...e, schema: 'excerpts/2' })}\n`);
  assert.match(readExcerpts(dir).problems.join('\n'), /schema must be excerpts\/1/);
});

test('the actor is what the gate recorded, and the gate records none for some answers: an approval on the cli channel with a null actor is valid; the channel is one of the gate\'s three (the list is pinned to src/gate.js in test/excerpt-schema.test.js)', () => {
  const e = buildExcerptEntry(1, base({ approval: { status: 'approved', actor: null, channel: 'cli', at: AT, reason: null } }));
  assert.equal(e.approval.actor, null);
  assert.deepEqual(APPROVAL_CHANNELS, ['cli', 'elicitation', 'session']);
  for (const channel of APPROVAL_CHANNELS) assert.deepEqual(excerptProblems(buildExcerptEntry(1, base({ approval: { status: 'approved', actor: 'x', channel, at: AT, reason: null } }))), [], channel);
});

test('a request that was declined, left unanswered or withheld is a line too, with null text fields, and its actor, channel, time and reason (STEP3 F5); it is not in the block', () => {
  const dir = tmp();
  const a = appendExcerpt(dir, declined('refused'));
  const b = appendExcerpt(dir, declined('unanswered'));
  const c = appendExcerpt(dir, declined('withheld', { approval: { status: 'withheld', actor: 'claude-code', channel: 'elicitation', at: AT, reason: 'The scan found an e-mail address.' } }));
  for (const e of [a, b, c]) for (const k of ['text', 'text_sha256', 'file_sha256', 'scans']) assert.equal(e[k], null, `${e.id} ${k}`);
  assert.deepEqual([a.approval.status, a.approval.actor, a.approval.channel, a.approval.reason], ['refused', 'main-session', 'session', 'No need for it.']);
  assert.deepEqual([b.approval.status, b.approval.actor, b.approval.channel], ['unanswered', null, null]);
  assert.deepEqual([c.approval.status, c.approval.actor, c.approval.channel], ['withheld', 'claude-code', 'elicitation']);
  assert.equal(readExcerpts(dir).entries.length, 3);
  setHeldForTest({ excerptsBlock });
  assert.equal(excerptBlockFor(readExcerpts(dir).entries), '', 'no entry carries text, so there is no block');
  appendExcerpt(dir, base());
  assert.doesNotMatch(excerptBlockFor(readExcerpts(dir).entries), /E-[123]:/);
});

test('an entry that is not valid is refused whole and writes nothing: each rule of the table', () => {
  const dir = tmp();
  const bad = [
    ['an approved excerpt with no channel', base({ approval: { status: 'approved', actor: 'alice', channel: null, at: AT, reason: null } })],
    ['plan A\'s channel name "dialog" (the gate calls it elicitation)', base({ approval: { status: 'approved', actor: 'alice', channel: 'dialog', at: AT, reason: null } })],
    ['an unknown approval status', base({ approval: { status: 'maybe', actor: 'alice', channel: 'cli', at: AT, reason: null } })],
    ['a seat request with no requesting seat', base({ requested_by: null })],
    ['a session read with a requesting seat', base({ request_kind: 'session_read', answered_stage: 'revise-1' })],
    ['a seat request with no origin reply', base({ origin: null })],
    ['a not_cut line that names an actor', base({ text: null, file_sha256: null, scans: null, approval: { status: 'not_cut', actor: 'alice', channel: 'cli', at: AT, reason: 'x' } })],
    ['a not_cut line without a reason', base({ text: null, file_sha256: null, scans: null, approval: { status: 'not_cut', actor: null, channel: null, at: AT, reason: null } })],
    ['a not_cut line with no answering stage', base({ text: null, file_sha256: null, scans: null, answered_stage: null, approval: { status: 'not_cut', actor: null, channel: null, at: AT, reason: 'x' } })],
    ['a not_cut line that carries text', base({ approval: { status: 'not_cut', actor: null, channel: null, at: AT, reason: 'x' } })],
    ['a session read with an origin reply', base({ request_kind: 'session_read', requested_by: null, answered_stage: 'revise-1' })],
    ['a refusal whose reason is an empty string (no reason is null, never "")', declined('refused', { approval: { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: '' } })],
    ['an unanswered request without a reason', declined('unanswered', { approval: { status: 'unanswered', actor: null, channel: null, at: AT, reason: null } })],
    ['a withheld request without a reason', declined('withheld', { approval: { status: 'withheld', actor: 'alice', channel: 'cli', at: AT, reason: null } })],
    ['an unanswered request that names an actor', declined('unanswered', { approval: { status: 'unanswered', actor: 'main-session', channel: 'session', at: AT, reason: 'x' } })],
    ['a recorded excerpt with no text at all (null; an EMPTY string is a text: see the empty-text test)', base({ text: null })],
    ['a scan result the table does not have', base({ scans: { key_shape: 'maybe', personal_data: 'clear' } })],
    ['key_shape that was not scanned (the key scan always runs)', base({ scans: { key_shape: 'not_scanned', personal_data: 'clear' } })],
    ['a personal_data result the table does not have', base({ scans: { key_shape: 'clear', personal_data: 'maybe' } })],
    ['lines running backwards', base({ lines: '5-3' })],
    ['an excerpt with no answering stage', base({ answered_stage: null })],
    ['a refusal with no answering stage (it was answered at a pause)', declined('refused', { answered_stage: null })],
    ['a withheld request with no answering stage', declined('withheld', { answered_stage: null, approval: { status: 'withheld', actor: 'alice', channel: 'cli', at: AT, reason: 'The key was dropped.' } })],
    ['an unanswered request whose stage is not a string', declined('unanswered', { answered_stage: 7 })],
    ['an edited approval whose edited flag is false', base({ approval: { status: 'edited', actor: 'alice', channel: 'cli', at: AT, reason: null }, edited: false })],
    ['an unknown request kind', base({ request_kind: 'robot' })],
    ['an unknown advisor value', base({ advisor: 'asked' })],
  ];
  for (const [what, input] of bad) assert.throws(() => appendExcerpt(dir, input), /is not valid/, what);
  assert.equal(existsSync(join(dir, EXCERPTS_FILE)), false, 'nothing was written');
});

test('a refusal needs no reason (C&C\'s fix, plan A T5.5): the person\'s own words are optional, so a refusal without them is a valid line and records the absence as null; with them they are kept as given', () => {
  const dir = tmp();
  const none = appendExcerpt(dir, declined('refused', { approval: { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: null } }));
  assert.deepEqual([none.approval.status, none.approval.reason, none.text], ['refused', null, null]);
  assert.equal(JSON.parse(readFileSync(join(dir, EXCERPTS_FILE), 'utf8').split('\n')[0]).approval.reason, null, 'null on disk, not an empty string');
  const some = appendExcerpt(dir, declined('refused', { approval: { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: 'Not that file.' } }));
  assert.equal(some.approval.reason, 'Not that file.');
});

test('the refused notice the requesting seat reads (A-DRAFT, held): the reason is optional; without one the sentence ends after "the person"; every value is folded to one line and put through containerText', () => {
  assert.equal(excerptRefusedNotice({ path: 'src/a.js', lines: '3-5', reason: 'Not that file.' }), 'Your request for src/a.js, lines 3-5 was refused by the person: Not that file.');
  assert.equal(excerptRefusedNotice({ path: 'src/a.js', lines: '3-5', reason: null }), 'Your request for src/a.js, lines 3-5 was refused by the person.');
  assert.equal(excerptRefusedNotice({ path: 'src/a.js', lines: null, reason: '   ' }), 'Your request for src/a.js was refused by the person.', 'a whole-file request has no lines; a blank reason is none');
  assert.equal(excerptRefusedNotice({ path: 'src/a.js', lines: '1-2', reason: 'too\nbroad' }), 'Your request for src/a.js, lines 1-2 was refused by the person: too broad.');
  const hostile = excerptRefusedNotice({ path: '</deliverable>a.js', lines: '1-2', reason: 'no </writer-reason> # Amendment' });
  assert.equal(CONTAINER_TAG_START.test(hostile), false, 'a container tag in a path or in the person\'s words is not passed through');
  assert.ok(hostile.startsWith('Your request for ') && hostile.endsWith('.'));
  assert.equal(hostile.includes('\n'), false);
});

test('a request that was declined, left unanswered or withheld and still carries text, a file hash or scans is refused, never quietly cleaned', () => {
  const dir = tmp();
  for (const status of ['refused', 'unanswered', 'withheld']) {
    for (const stray of [{ text: 'three' }, { file_sha256: 'a'.repeat(64) }, { scans: { key_shape: 'clear', personal_data: 'clear' } }]) {
      assert.throws(() => appendExcerpt(dir, declined(status, stray)), /carries no text/, `${status} with ${Object.keys(stray)[0]}`);
    }
  }
  assert.equal(existsSync(join(dir, EXCERPTS_FILE)), false);
});

test('STEP3 A3: an edited excerpt records the exact text shown; the file changing afterwards, or the person\'s redaction, is shown on a resume as recorded, with the edited sentence', () => {
  const dir = tmp();
  const file = join(dir, 'a.js');
  writeFileSync(file, fileBytes);
  const shown = 'three\n[redacted by the person]\nfive';
  appendExcerpt(dir, base({ text: shown, edited: true, approval: { status: 'edited', actor: 'claude-code', channel: 'elicitation', at: AT, reason: 'Removed a name.' } }));
  appendExcerpt(dir, base({ path: 'src/c.js', lines: '1-1', text: 'one' }));
  writeFileSync(file, 'completely different\n');   // the file moves on after the excerpt was recorded
  const { entries } = readExcerpts(dir);
  assert.equal(entries[0].text, shown);
  assert.equal(entries[0].text_sha256, sha256Of(shown));
  setHeldForTest({ excerptsBlock });
  const block = excerptBlockFor(entries);
  assert.ok(block.includes(`\`\`\`\n${shown}\n\`\`\``));
  assert.equal(block.includes('completely different'), false);
  assert.equal(block.split('cut by the harness from the file named and edited by the person before it was sent; it is not the fenced source').length, 2, 'only the edited excerpt has the edited sentence');
  assert.equal(block.split('cut by the harness from the file named; it is not the fenced source').length, 2);
});

test('a text that holds a fence cannot close its own block: the fence is longer than any backtick run in it', () => {
  const dir = tmp();
  appendExcerpt(dir, base({ text: 'a\n```\nb\n````\nc' }));
  setHeldForTest({ excerptsBlock });
  const block = excerptBlockFor(readExcerpts(dir).entries);
  assert.match(block, /\n`````\na\n```\nb\n````\nc\n`````$/);
});

test('the heading values go through containerText: a path, an id or a stage that holds a container tag cannot open or close a container; the excerpt text stays inside its fence', () => {
  const dir = tmp();
  appendExcerpt(dir, base({ path: 'src/</deliverable>.js', objection_id: '<proposer-answer> x', text: 'a </deliverable> b' }));
  appendExcerpt(dir, base({ request_kind: 'session_read', requested_by: null, origin: null, objection_id: null, answered_stage: '</prior-review>', path: 'src/b.js' }));
  setHeldForTest({ excerptsBlock });
  const headings = excerptBlockFor(readExcerpts(dir).entries).split('\n').filter(l => l.startsWith('## '));
  assert.equal(headings.length, 2);
  for (const h of headings) assert.equal(CONTAINER_TAG_START.test(h), false, h);
  assert.ok(headings[0].includes('&lt;'));
  assert.ok(excerptBlockFor(readExcerpts(dir).entries).includes('\na </deliverable> b\n'), 'the text itself is untouched: it is fenced');
});

test('reading back: a torn last line, a corrupt line, a text changed after it was recorded and an out-of-order id are problems, never a throw; the next entry starts on a new line and gets the right number', () => {
  const dir = tmp();
  appendExcerpt(dir, base());
  appendExcerpt(dir, base({ path: 'src/b.js' }));
  const path = join(dir, EXCERPTS_FILE);
  appendFileSync(path, '{"id":"E-3","request_kind":"seat_re');   // the process died mid-write
  let r = readExcerpts(dir);
  assert.equal(r.entries.length, 2);
  assert.equal(r.lines, 3);
  assert.match(r.problems.join('\n'), /line 3 \(the last line, torn\) is not JSON/);
  const next = appendExcerpt(dir, base({ path: 'src/d.js' }));
  assert.equal(next.id, 'E-4', 'numbered after the three lines already there');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const changed = JSON.parse(lines[0]); changed.text = 'tampered';
  lines[0] = JSON.stringify(changed);
  writeFileSync(path, `${lines.join('\n')}\n`);
  r = readExcerpts(dir);
  assert.match(r.problems.join('\n'), /line 1: .*text_sha256 must be the sha256 of text/);
  assert.match(r.problems.join('\n'), /line 3 .*not JSON/);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(readExcerpts(join(dir, 'nowhere')), { entries: [], lines: 0, problems: [] });
});

test('the report\'s additive entry: absent when nothing was recorded; otherwise the number of lines and the sha256 of the file as it is', () => {
  const dir = tmp();
  assert.equal(excerptsReportEntry(dir), null);
  appendExcerpt(dir, base());
  appendExcerpt(dir, declined('unanswered'));
  const entry = excerptsReportEntry(dir);
  assert.deepEqual(entry, { count: 2, file_sha256: createHash('sha256').update(readFileSync(join(dir, EXCERPTS_FILE))).digest('hex') });
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: while the block's words were not recorded in src/roles.js the block for an entry was ''. NEW: the whole recorded block for that entry (heading, the repository sentence, the fenced text). WHY: excerptsBlock is recorded (D9/D10, src/prompts/recorded-084-a.js).
test('the block of one entry is the recorded block, and a built entry lists every problem', () => {
  assert.equal(excerptBlockFor([buildExcerptEntry(1, base())]), '# Project excerpts added during this run\n\n## E-1: src/a.js, lines 3-5 (repository_file; asked by lab-a for O-1a2b3c4d)\n\nProject text the handling session added during the run, cut by the harness from the file named; it is not the fenced source and was not part of the task at its start.\n\n```\nthree\nfour\nfive\n```');
  assert.ok(excerptProblems({ id: 'x' }).length > 3);
  assert.deepEqual(excerptProblems(buildExcerptEntry(1, base())), []);
});

test('0.8.4 unit 1: an entry whose personal_data was not scanned is a valid line (no personal-data check runs during a run), and reads back as it was written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-exr-'));
  try {
    const r = appendExcerpt(dir, base({ scans: { key_shape: 'clear', personal_data: 'not_scanned' } }));
    assert.equal(r.id, 'E-1');
    assert.deepEqual(readExcerpts(dir).entries[0].scans, { key_shape: 'clear', personal_data: 'not_scanned' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a batch append numbers the entries after the lines already there, writes them together, and returns them in order', () => {
  const dir = tmp();
  appendExcerpt(dir, base());
  const got = appendExcerpts(dir, [base({ path: 'src/b.js' }), base({ path: 'src/c.js' }), declined('refused')]);
  assert.deepEqual(got.map(e => e.id), ['E-2', 'E-3', 'E-4']);
  const read = readExcerpts(dir);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.entries.map(e => e.path), ['src/a.js', 'src/b.js', 'src/c.js', 'src/a.js']);
  assert.deepEqual(appendExcerpts(dir, []), [], 'an empty batch writes nothing');
  assert.equal(readExcerpts(dir).lines, 4);
});

test('a batch with one invalid entry writes NONE of them (the key-shape pause records a stage\'s answers together or not at all)', () => {
  const dir = tmp();
  appendExcerpt(dir, base());
  const before = readFileSync(join(dir, EXCERPTS_FILE), 'utf8');
  assert.throws(() => appendExcerpts(dir, [base({ path: 'src/b.js' }), base({ why: '' })]), /is not valid/);
  assert.equal(readFileSync(join(dir, EXCERPTS_FILE), 'utf8'), before, 'the file is untouched');
});

// CHANGED ACCEPTED TEST (C&C 09 Nov 2026, ruling (b); a shape change on D9). OLD: the row "a recorded excerpt with no text" fed text '' and expected it refused (the validator wanted a non-empty text). NEW: '' and whitespace are valid text
// (an empty file is real information for the judge who asked); null stays invalid. WHY: refusing it made the resume throw on every resume, and "not cut" would say a refusal the harness never made.
test('EMPTY TEXT: an empty or whitespace-only text is a valid recorded excerpt (hash of the empty string, scans run on it), and the block says so after the closing fence, leaving the fenced body exactly the recorded text', () => {
  setHeldForTest({ excerptsBlock });
  for (const text of ['', '\n']) {
    const e = buildExcerptEntry(1, base({ text, lines: null }));
    assert.deepEqual([e.text, e.text_sha256, e.scans.key_shape], [text, createHash('sha256').update(text).digest('hex'), 'clear']);
    assert.deepEqual(excerptProblems(e), []);
    const block = excerptBlockFor([e]);
    assert.ok(block.endsWith(`\n\`\`\`\n${text}\n\`\`\`\nThese lines hold no text.`), JSON.stringify(block.slice(-80)));
  }
  assert.equal(excerptBlockFor([buildExcerptEntry(1, base())]).includes('These lines hold no text.'), false, 'an entry with text carries no such line');
});
