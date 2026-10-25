// Audit item 7 (0.8.3), commit 1: ONE definition of "hidden characters" (src/hidden-chars.js) and the producers that refuse or strip with it: the advice brief, the contract lint and request,
// the return path. Review/Build_0.8.3/m6-closing/Item7_Gate_Note.md (+ addendum). Offline, $0. EVERY payload is built with String.fromCodePoint: a `\u` escape typed through an editor or a
// command can arrive as the literal invisible character, which would put the hidden characters into this file itself (a scan below checks that this file holds none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hiddenChars from '../src/hidden-chars.js';
import { HIDDEN_CLASS_SOURCE, hiddenIn, countHidden, markHidden, stripHiddenChars, briefHiddenRegex, isHiddenPoint, isQuietPoint } from '../src/hidden-chars.js';
import { hiddenCharacterIn, briefRefusal } from '../src/advice-brief.js';
import { hiddenCharacterReport, stripHidden } from '../src/return-path.js';
import { terminalSafe } from '../src/terminal-safe.js';
import { lintContractDraft } from '../src/contract-lint.js';
import { requestAmendment } from '../src/contract-record.js';
import { writeLocked } from '../scripts/contract-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cp = (...a) => String.fromCodePoint(...a);
const hex = c => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
const range = (a, b = a) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// THE FLOOR: the code points the advice brief refused with its hand-written list before this unit (487 of them, in this order of ranges). Nothing in it may drop out of the new class.
const OLD_BRIEF_LIST = [[0, 8], [0xB, 0xC], [0xE, 0x1F], [0x7F, 0x9F], [0xAD], [0x34F], [0x61C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x206F],
  [0x2800], [0x3164], [0xFE00, 0xFE0E], [0xFEFF], [0xFFA0], [0xE0000, 0xE007F], [0xE0100, 0xE01EF]].flatMap(([a, b]) => range(a, b));
// what a pin check reports as missing from a candidate matcher (the check itself, so a row can show that it goes red)
const missingFrom = (re, points) => points.filter(c => !re.test(cp(c)));

test('the floor pin can FAIL: one code point outside the class (e with acute, U+00E9) is reported missing, a code point inside it is not', () => {
  const re = briefHiddenRegex();
  assert.deepEqual(missingFrom(re, [...OLD_BRIEF_LIST.slice(0, 5), 0xE9]), [0xE9]);
  assert.deepEqual(missingFrom(re, OLD_BRIEF_LIST.slice(0, 5)), []);
});

test('the floor: every code point the advice brief used to refuse (487) is still refused, and the new list gains only invisible members (no letter, digit, space or mark gains a refusal)', () => {
  assert.equal(OLD_BRIEF_LIST.length, 487);
  const re = briefHiddenRegex();
  assert.deepEqual(missingFrom(re, OLD_BRIEF_LIST), []);
  const gained = [];
  for (let c = 0; c <= 0x10FFFF; c++) { if (c >= 0xD800 && c <= 0xDFFF) continue; if (re.test(cp(c)) && !OLD_BRIEF_LIST.includes(c)) gained.push(c); }
  // the exotic default-ignorable members the hand-written list lacked; U+FE0F (emoji) and the line separators stay allowed as they always were
  const allowed = [...range(0xFFF0, 0xFFF8), ...range(0x1BCA0, 0x1BCA3), ...range(0x1D173, 0x1D17A), ...range(0xE0080, 0xE00FF), ...range(0xE01F0, 0xE0FFF)];
  assert.deepEqual(gained.filter(c => !allowed.includes(c)).map(hex), []);
  for (const c of [0xFE0F, 0x2028, 0x2029, 0x9, 0xA, 0xD, 0x20, 0xA0, 0x3000, 0x41, 0xE9, 0x4E2D, 0x1F600]) assert.equal(re.test(cp(c)), false, hex(c));
});

test('the class: variation selectors, fillers, the grapheme joiner, the braille blank and the zero-width marks are hidden; letters, spaces and a no-break space are not', () => {
  for (const c of [0xFE00, 0xFE0E, 0xE0100, 0xE01EF, 0x3164, 0x115F, 0xFFA0, 0x34F, 0x2800, 0x200B, 0x2060, 0xAD, 0xFEFF, 0xE0041, 0x202E]) assert.equal(isHiddenPoint(c), true, hex(c));
  for (const c of [0x41, 0xE9, 0x20, 0xA0, 0x3000, 0x2003, 0x4E2D, 0x1F600, 0x600, 0x6DD]) assert.equal(isHiddenPoint(c), false, hex(c));
  assert.equal(hiddenIn(`ab${cp(0xFE00)}c`).code, 'U+FE00');
  assert.equal(hiddenIn(`ab${cp(0xFE00)}c`).near, 'ab');
  assert.equal(hiddenIn(`caf${cp(0xE9)} ${cp(0xA0)}x`), null);
});

test('the quiet joiners are never a reason to refuse in authored text, but they are still hidden and still counted', () => {
  for (const c of [0xAD, 0x200C, 0x200D, 0xFE0F, 0x180B, 0x180C, 0x180D, 0x180F, 0x17B4, 0x17B5]) {
    assert.equal(isQuietPoint(c), true, hex(c)); assert.equal(isHiddenPoint(c), true, hex(c));
    const t = `a${cp(c)}b`;
    assert.equal(hiddenIn(t, { allowQuiet: true }), null, hex(c));
    assert.equal(hiddenIn(t).code, hex(c));
    assert.equal(countHidden(t), 1, hex(c));
  }
  assert.equal(hiddenIn(`a${cp(0x200C, 0xFE00)}b`, { allowQuiet: true }).code, 'U+FE00', 'a quiet joiner does not hide a loud neighbour');
});

test('the emoji rule only quiets the count: ONE U+FE0F after a pictograph and U+200D between two are not counted or marked; anywhere else they are', () => {
  const smile = cp(0x1F600);
  assert.equal(countHidden(`a${smile}${cp(0xFE0F)}`), 0);
  assert.equal(countHidden(`a${cp(0xFE0F)}`), 1, 'a bare selector in prose');
  assert.equal(countHidden(`${smile}${cp(0xFE0F, 0xFE0F)}`), 1, 'a run of selectors after one emoji: the second one is hidden');
  assert.equal(countHidden(cp(0x1F468, 0x200D, 0x1F469)), 0, 'a joiner between two pictographs');
  assert.equal(countHidden(`a${cp(0x200D)}b`), 1, 'a joiner between letters');
  assert.equal(countHidden(`${smile}${cp(0x200D)}b`), 1, 'a joiner with only one pictograph beside it');
  assert.equal(hiddenIn(`${smile}${cp(0xFE0F)}`, { allowQuiet: true }), null, 'and nothing is refused because of them');
});

test('markHidden shows each hidden character in place as [U+XXXX] and leaves an explained emoji sequence alone', () => {
  assert.equal(markHidden(`x${cp(0x200B)}y`), 'x[U+200B]y');
  assert.equal(markHidden(`x${cp(0xE0100, 0x3164)}y`), 'x[U+E0100][U+3164]y');
  const emoji = `${cp(0x1F600, 0xFE0F)} ${cp(0x1F468, 0x200D, 0x1F469)}`;
  assert.equal(markHidden(emoji), emoji);
  assert.equal(markHidden(`caf${cp(0xE9)}`), `caf${cp(0xE9)}`);
});

test('stripHiddenChars removes the class and keeps the quiet joiners', () => {
  assert.equal(stripHiddenChars(`a${cp(0x3164, 0xFE00, 0xE0100, 0x2800, 0x34F)}b`), 'ab');
  const keep = `a${cp(0xAD, 0x200C, 0x200D, 0xFE0F, 0x180B, 0x17B4)}b`;
  assert.equal(stripHiddenChars(keep), keep);
});

test('the advice brief refuses with the module (a variation selector or a filler in any field), allows the emoji selector, and says what it found', () => {
  const brief = tail => ({ schema_version: 'advice-brief/1', moment: 'before_commit', question: `Should we ship it${tail}?`, decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
    options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
    tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }], sensitivity: 'internal', not_included: ['the conversation', 'environment variables'] });
  for (const c of [0xFE00, 0x3164, 0x1D173]) assert.equal(hiddenCharacterIn(brief(cp(c)))?.code, hex(c), hex(c));
  assert.equal(hiddenCharacterIn(brief(cp(0xFE0F))), null, 'the emoji selector was always allowed in a brief');
  assert.match(briefRefusal(brief(cp(0xFE00))), /invisible or control character \(U\+FE00/);
});

test('return path: the report counts the whole class apart from tags and bidi, and stripHidden removes it; the quiet joiners and a real England flag stay', () => {
  const hidden = [0xFE00, 0xFE0E, 0x3164, 0x2800, 0x34F, 0xE0100, 0x200B, 0x2061, 0xFEFF];
  const text = `a${cp(...hidden)}b`;
  const r = hiddenCharacterReport(text);
  assert.equal(r.invisible_characters, hidden.length, JSON.stringify(r));
  assert.equal(stripHidden(text), 'ab');
  const quiet = `a${cp(0xAD, 0x200C, 0x200D, 0xFE0F)}b`;
  assert.deepEqual(hiddenCharacterReport(quiet), { tag_characters: 0, bidi_controls: 0 });
  assert.equal(stripHidden(quiet), quiet);
  const england = cp(0x1F3F4, ...[...'gbeng'].map(ch => 0xE0000 + ch.codePointAt(0)), 0xE007F);
  assert.equal(stripHidden(`x${england}${cp(0xFE00)}y`), `x${england}y`);
  assert.equal(hiddenCharacterReport(`x${england}`).tag_characters, 0);
});

test('contract lint refuses a variation selector, a filler or the braille blank in an obligation text and in its check, and still accepts the quiet joiners', () => {
  for (const c of [0xFE00, 0x3164, 0x2800, 0x34F, 0x2061, 0x206A, 0xFEFF]) {
    assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: `a${cp(c)}b` }] }).ok, false, `text ${hex(c)}`);
    assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', check: `c${cp(c)}d` }] }).ok, false, `check ${hex(c)}`);
  }
  for (const c of [0xAD, 0x200C, 0x200D, 0xFE0F, 0x17B4]) assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: `a${cp(c)}b` }] }).ok, true, `quiet ${hex(c)}`);
});

test('contract amendment request: a hidden character in the reason or the proposed text is refused (hidden_characters), a quiet joiner is not', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'thc-hidden-')), 'run-x'); writeLocked(dir);
  const ask = (reason, proposed_text) => requestAmendment(dir, { version: 1, obligation_id: 'O2', reason, proposed_text });
  for (const c of [0xFE00, 0x3164, 0x2800]) {
    assert.equal(ask('r', `A new wording${cp(c)} of it.`).code, 'hidden_characters', `proposed ${hex(c)}`);
    assert.equal(ask(`why${cp(c)}`, 'A new wording of it.').code, 'hidden_characters', `reason ${hex(c)}`);
  }
  for (const c of [0x200D, 0xAD]) assert.notEqual(ask('r', `A new wording${cp(c)} of it.`).code, 'hidden_characters', `${hex(c)} is quiet: not refused`);
  assert.equal(ask('r', `A new${cp(0xFEFF)} wording of it.`).code, 'hidden_characters', 'an INTERIOR byte-order mark is hidden');
});

test('a LEADING byte-order mark is an encoding artifact: stripped at the boundary (a contract request payload, a draft file), recorded nowhere', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'thc-hidden-bom-')), 'run-x'); writeLocked(dir);
  const req = requestAmendment(dir, { version: 1, obligation_id: 'O2', reason: `${cp(0xFEFF)}why`, proposed_text: `${cp(0xFEFF)}A new wording of it.` });
  assert.equal(req.ok, true, JSON.stringify(req));
  const ledger = readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8');
  assert.equal(ledger.includes(cp(0xFEFF)), false, 'the byte-order mark is not in the record');
  assert.equal(typeof hiddenChars.stripLeadingBom, 'function');
  assert.equal(hiddenChars.stripLeadingBom?.(`${cp(0xFEFF)}x`), 'x'); assert.equal(hiddenChars.stripLeadingBom?.(`x${cp(0xFEFF)}`), `x${cp(0xFEFF)}`);
  // a draft FILE saved with a byte-order mark is still a draft: `contract lock` asks for the gate (exit 3), it does not fail on the parse
  const work = mkdtempSync(join(tmpdir(), 'thc-hidden-bomfile-')); const run = join(work, 'runs', 'run-x'); mkdirSync(join(run, 'contract'), { recursive: true });
  writeFileSync(join(run, 'report.json'), JSON.stringify({ passed: true, criteria: ['one', 'two'] }));
  writeFileSync(join(run, 'contract', 'draft.json'), cp(0xFEFF) + JSON.stringify({ obligations: [{ id: 'O1', text: 'Every error path prints one line.' }] }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), 'contract', 'lock', 'runs/run-x'], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
});

// ---- the sixth-list scan (paraphrase set enumerated in Item7_Gate_Note.md, addendum A3) ----------------------------------------------------------------------------------------------------
const PROPS = String.raw`\\[pP]\{(Cf|Mn|Me|M|Mark|Cc|Cn|C|Other|Control|Format|Unassigned|Zl|Zp|Line_Separator|Paragraph_Separator|Default_Ignorable_Code_Point|DI|Variation_Selector|VS|Nonspacing_Mark|Enclosing_Mark|Bidi_Control|Bidi_C|Join_Control|Join_C|Emoji_Component|EComp|(General_Category|gc|Gc)=\w+)\}`;
// P2 and P3 are DERIVED from the class: every code point named by an escape (4-digit, braced, \xNN) or a 0x literal is tested with isHiddenPoint, so a range endpoint that is any member of the class is caught, not a hand-kept list of anchors
const BS = String.fromCharCode(92);
const ESCAPES = [new RegExp(`${BS}${BS}u([0-9a-fA-F]{4})`, 'g'), new RegExp(`${BS}${BS}u${BS}{([0-9a-fA-F]{1,6})${BS}}`, 'g'), new RegExp(`${BS}${BS}x([0-9a-fA-F]{2})`, 'g')];
const HEXLIT = /\b0x([0-9a-fA-F]{2,6})\b/g;
const namedPoints = (src, res) => res.flatMap(re => [...src.matchAll(re)].map(m => parseInt(m[1], 16)));
const hiddenNamed = (src, res) => namedPoints(src, res).filter(c => c <= 0x10FFFF && isHiddenPoint(c));
const SCANS = [
  ['a Unicode property for the class (P1)', src => new RegExp(PROPS).test(src)],
  ['a hard-coded escape of a hidden code point (P2)', src => hiddenNamed(src, ESCAPES).length > 0],
  ['a hidden code point as a 0x number (P3)', src => hiddenNamed(src, [HEXLIT]).length > 0],
  ['a hidden anchor as a decimal (P4)', src => /\b(8203|8204|8205|8288|10240|12644|65024|65279|917760|917504)\b/.test(src)],
  ['a pasted invisible character (P5)', src => new RegExp(`[${HIDDEN_CLASS_SOURCE}]`, 'u').test(src)],
];
const listsIn = src => SCANS.filter(([, test]) => test(src)).map(([why]) => why);
// the files that may hold one of these, each with the reason (one line per file); everything else under src/ must ask the module. Every entry except the module must STILL hold a hit (a stale exemption fails the scan)
const EXEMPT = {
  'src/hidden-chars.js': 'the definition itself',
  'src/return-path.js': 'the report\'s own categories (tag block, bidi controls: both pinned below to be subsets of the class) and the flag sequence',
  'src/terminal-safe.js': 'the display filter: controls and bidi marks only; pinned below to be a subset of the class plus controls',
  'src/fence.js': 'file NAMES (controls and bidi only); countInvisible over file content asks the module',
  'src/unknown-flag.js': 'a flag-dash guard (format and space characters before a dash), not text hiding',
  'src/name-lint.js': '\\p{M} as part of WORD letters, not hiding',
};
const srcFiles = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? srcFiles(p) : (p.endsWith('.js') ? [p] : []); });

test('the scan can FAIL: each paraphrase of a hidden-character list is flagged (property names, escapes of ANY class member, braced escapes, two-digit hex escapes, hex and decimal numbers, a pasted character), plain code is not', () => {
  const U = String.fromCharCode(92) + 'u'; const X = String.fromCharCode(92) + 'x'; const P = String.fromCharCode(92) + 'p';
  const flagged = {
    'a Unicode property for the class (P1)': [`/[${P}{Mn}]/u`, `/${P}{Bidi_C}/u`, `/${P}{Join_Control}/u`, `/${P}{gc=Cf}/u`, `/${P}{Default_Ignorable_Code_Point}/u`, `/${P}{Cn}/u`, `/${P}{M}/u`],
    'a hard-coded escape of a hidden code point (P2)': [`/[${U}2060]/`, `/[${U}200c-${U}200f]/`, `/${X}ad/`, `/${U}{E0100}/u`, `/[${U}2061-${U}2064]/`, `/${U}1160/`],
    'a hidden code point as a 0x number (P3)': ['if (c >= 0xFE00 && c <= 0xFE0F) hide();', 'const X = [0x3164, 0x2800];'],
    'a hidden anchor as a decimal (P4)': ['const SET = new Set([8203, 65279]);'],
    'a pasted invisible character (P5)': [`const X = 'a${cp(0x3164)}b';`, `const X = 'a${cp(0x180C)}b';`],
  };
  for (const [why, samples] of Object.entries(flagged)) for (const src of samples) assert.ok(listsIn(src).includes(why), `${why}: ${JSON.stringify(src)} -> ${JSON.stringify(listsIn(src))}`);
  for (const ok of ['const ok = text.replace(/[a-z]+/g, "");', `const dash = /${U}2014/;`, `const e = /${X}41/;`, 'const n = 0x1F;', 'const re = /' + P + '{L}+/u;']) assert.deepEqual(listsIn(ok), [], ok);
});

test('no sixth list: under src/ only the exempt files hold a hidden-character list, and no exemption is stale', () => {
  const found = {};
  for (const file of srcFiles(join(root, 'src'))) {
    const rel = relative(root, file);
    const why = listsIn(readFileSync(file, 'utf8'));
    if (why.length) found[rel] = why;
  }
  const unlisted = Object.keys(found).filter(f => !(f in EXEMPT));
  assert.deepEqual(unlisted, [], `a hidden-character list outside src/hidden-chars.js: ${JSON.stringify(unlisted.map(f => [f, found[f]]))}. Use the module, or add the file to EXEMPT with its reason.`);
  for (const f of Object.keys(EXEMPT)) assert.ok(statSync(join(root, f)).isFile(), `the exemption names a file that exists: ${f}`);
  const stale = Object.keys(EXEMPT).filter(f => f !== 'src/hidden-chars.js' && !(f in found));
  assert.deepEqual(stale, [], `an exemption whose file no longer holds a list: remove it from EXEMPT (${stale.join(', ')})`);
});

test('the exempt files\' own sets cannot drift outward: whatever the return path counts as a tag or bidi character, and whatever the terminal filter removes, is inside the class (or a control character)', () => {
  const control = /[\x00-\x1f\x7f-\x9f]/;
  const outside = { returnPath: [], terminal: [] };
  for (const c of [...range(0, 0x2FFFF), ...range(0xE0000, 0xE0FFF)]) {
    if (c >= 0xD800 && c <= 0xDFFF) continue;
    const ch = cp(c);
    const r = hiddenCharacterReport(ch);
    if (r.tag_characters + r.bidi_controls > 0 && !isHiddenPoint(c)) outside.returnPath.push(hex(c));
    if (terminalSafe(ch) === '' && !isHiddenPoint(c) && !control.test(ch)) outside.terminal.push(hex(c));
  }
  assert.deepEqual(outside, { returnPath: [], terminal: [] });
});

test('this test file holds no invisible character itself (every payload is built from numbers)', () => {
  const me = readFileSync(join(root, 'test/hidden-chars.test.js'), 'utf8');
  // the scan constants above are built from code points, so a hit here would be a pasted character
  assert.equal(new RegExp(`[${HIDDEN_CLASS_SOURCE}]`, 'u').test(me), false);
});
