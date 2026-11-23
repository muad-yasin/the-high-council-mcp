// 0.8.4, lane C, unit 5: the fifteen voice lines of the seats of chains/plan-the-high-council.json (test/held-prompts/held-084-c.js SEAT_VOICE_LINES). The lines were settled with the maintainer, word for word, in a session window on
// 4 Nov 2026; this test pins each one by its length and its SHA-256 (the expected values are NOT computed from the code under test: they were taken from the settled text), so a changed word anywhere is a red row by name.
// Every line is A-DRAFT until the release wording review; nothing here is recorded in src/roles.js (the frame stays the recorded one, and the lines are held test data until the one re-record). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seatVoiceBlock, SEAT_VOICE_LINES } from './held-prompts/held-084-c.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-the-high-council.json'), 'utf8'));
const proposers = chain.seats.proposers.map(s => s.persona);
const judges = chain.seats.critics.map(s => s.persona);
// HIS FRAME, typed here verbatim (the recorded judge voice, src/roles.js judgePersonaBlock form voice): not built from the code under test.
const FRAME = name => `You have a seat in THE HIGH COUNCIL, and you speak in the voice of ${name}. The Council will debate on the Software Engineering behind this debate's build plan, and together with the other seats, you will help to improve it, with manners and in harmony. Thank you very much in advance, dear Council member. :)`;
// name -> [the seat's kind in the chain, length in characters, SHA-256 of the line]
const PINS = {
  "Noah": ['proposer', 748, '8118aee4c84766e0e133993c75394516b547ccd8e0208c825ca43912f1bcbf68'],
  "Husayn": ['proposer', 1064, '7a64ea03b9f46f852fe3310465da28379af122d6a33c08e7bb58f82d9a3149f0'],
  "Abraham": ['proposer', 958, '807924328eef23c30cd9056ca51610ce5641888c8e11eb33116211218e97a054'],
  "Matthew": ['judge', 1153, '3b81dd54031546966e7cd9359ad6f22b9fee092fc7cacda5bdbbb8a2e5738b0f'],   // CHANGED ACCEPTED (his voice review, part 1, 13 Nov 2026; NS-0247, two edits): OLD 1118 characters, SHA-256 dfda3faa6003...b04d. FIRST EDIT 1139, 071724a97fd8...5060 ("a great teacher", "Him" and "He" for the teacher, "One of the first things", and the two words of the teacher in his marks). NEW 1153, 3b81dd540315...8b0f: his own sentence in place of the two quoted words, no quotation marks ("looked at him and called him to follow Him, and Matthew stood up, left everything behind and followed Him")
  "Merkel": ['judge', 1422, '4e33a1c34be8f23d8f3d93f7e5ca930dcd7b144cab2191b69812b1e25f8c97ad'],
  "Herbert": ['judge', 1567, 'af0b2698197c43ec102788212f9bfeee8459741b2cf79c94122fa07eebf3451e'],   // CHANGED ACCEPTED (his voice review, part 1; NS-0249): OLD 1554 characters, SHA-256 d417267a67beaabd...3228cce. NEW 1567, af0b2698197c43ec...f3451e ("He thought in and beyond centuries, about ecology, philosophy, power": "religion" became "philosophy", his own suggestion)
  "Van Gogh": ['judge', 1252, '3446d1e51450dc05a9b0ccb0f2d3ed90452ccd08671eb69703605e7de449383b'],
  "Aristotle": ['judge', 1497, '70284b9cb01febe8706422794e7d49878b3fe2aa5669179ef4ae099a1a960c40'],
  "Moses": ['judge', 1535, '6a341a21c5c00b496f4f3c79c88f4b6585c1b15a128718f56bdd9b7a43283824'],
  "Einstein": ['judge', 1574, '9e2dfc17ceb9e0488783896cb155d32910b734181e5a3ac11b0913821a2c05cb'],
  "da Vinci": ['judge', 1449, '3d5b749a6df0b38e8b5c4eab634cca8e71ae20b75e9cbfc9bf3fe6a934988367'],
  "Archimedes": ['judge', 1648, '609f098b2d83e09fa22e8bd6d4db6d425fc6fb5229ae0abc3ddc2e5ed9afd075'],
  "Plato": ['judge', 1659, 'b388f37784483425c01d2922658996860296e77b39cb4aed37c419bbc6914d64'],
  "Melchizedek": ['judge', 1853, '67146fe14b115ebe56a6cf594fd4856bfa93c348f13c272b7d473106fb477dba'],   // CHANGED ACCEPTED (his voice review, part 1, 13 Nov 2026; NS-0257, his "yes please" to the line shown whole): OLD 967 characters, SHA-256 4a3fa2199af5...2bfd. NEW 1853, 67146fe14b11...7dba (the line that opens "Melchizedek was king of Salem, the city of peace, and priest of God Most High")
  "Karpathy": ['judge', 1963, '1e2f7d733fa9be51f7ea872f412895d11333b37472dc94238e807337914df675'],
};
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

test('LINES, the table: its keys are exactly the fifteen persona names of plan-the-high-council, spelled as the chain spells them, and the kinds match the chain', () => {
  assert.equal(proposers.length, 3);
  assert.equal(judges.length, 12);
  assert.deepEqual(Object.keys(SEAT_VOICE_LINES).sort(), [...proposers, ...judges].sort());
  assert.deepEqual(Object.keys(PINS).sort(), Object.keys(SEAT_VOICE_LINES).sort());
  for (const [name, [kind]] of Object.entries(PINS)) assert.equal(kind, proposers.includes(name) ? 'proposer' : 'judge', `${name}: kind`);
});

for (const [name, [, length, digest]] of Object.entries(PINS)) {
  test(`LINE ${name}: byte for byte as settled (length and SHA-256)`, () => {
    const line = SEAT_VOICE_LINES[name];
    assert.equal(typeof line, 'string', `${name} has a line`);
    assert.equal(line.length, length, `${name}: length`);
    assert.equal(sha(line), digest, `${name}: SHA-256`);
  });
}

test('LINES, shape: plain ASCII, no quotation marks and no dashes, one orientation sentence at the end that fits the seat\'s kind, and none favours a smaller or shorter plan', () => {
  for (const [name, line] of Object.entries(SEAT_VOICE_LINES)) {
    assert.match(line, /^[\x20-\x7e]+$/, `${name}: printable ASCII only`);
    // CHANGED ACCEPTED (his voice review, part 1; NS-0247, second edit): the first edit let Matthew's line carry ONE quotation ("Follow me,"). NEW: no line carries a quotation mark again, as before that edit.
    assert.doesNotMatch(line, /["`]|“|”|—|–/, `${name}: no quotation marks, no dashes`);
    const proposer = proposers.includes(name);
    const phrase = proposer ? 'A proposal from this seat is made in that spirit:' : 'A judgement from this seat';
    assert.equal(line.split(phrase).length - 1, 1, `${name}: the orientation sentence once`);
    assert.ok(!(proposer ? 'A judgement from this seat' : 'A proposal from this seat') || !line.includes(proposer ? 'A judgement from this seat' : 'A proposal from this seat'), `${name}: not the other kind's sentence`);
    assert.ok(line.endsWith('.'), `${name}: ends with a full stop`);
    assert.doesNotMatch(line.slice(line.indexOf(phrase)), /\b(shorter|smaller|concise|briefer|fewer|less is more|minimal|lean)\b/i, `${name}: the orientation never favours size (the owner's rule: size never decides)`);
  }
  assert.ok(SEAT_VOICE_LINES.Melchizedek.endsWith('for the peace of the whole Council.'), 'Melchizedek ends on Council with a capital C');
});

test('VOICE, with the table: every seat gets the recorded frame, a single space, then its own line, for every job; the name is matched ignoring case', () => {
  for (const name of Object.keys(PINS)) for (const job of ['judge', 'propose', 'debate', 'reply']) {
    assert.equal(seatVoiceBlock({ name, job }), `${FRAME(name)} ${SEAT_VOICE_LINES[name]}`, `${name} ${job}`);
    assert.equal(seatVoiceBlock({ name: name.toUpperCase(), job }), `${FRAME(name.toUpperCase())} ${SEAT_VOICE_LINES[name]}`, `${name} upper-case ${job}`);
  }
  assert.equal(seatVoiceBlock({ name: 'Nobody', job: 'judge' }), FRAME('Nobody'), 'a name with no line: the frame alone');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: plan-the-high-council stayed on the title form and the nine long lines below carried their drafted length and SHA-256. NEW: the flagship chain is on the voice form, and the nine lines carry the recorded length and SHA-256 (src/prompts/recorded-084-c.js SEAT_VOICE_LINES). WHY: WORDING_0.8.4.md section E #14 (the flagship flips to voice), the SEAT_VOICE_LINES rows NS-0244 to NS-0258 of RESOLVED_LIST (the fifteen lines, CORRECTED 11 Nov) and the flagship's form (aa28d72a).
test('VOICE, the shipped chain is on the voice form: the voice with these lines is the form of plan-the-high-council', () => {
  assert.deepEqual(chain.seat_personas, { enabled: true, form: 'voice' });
});
