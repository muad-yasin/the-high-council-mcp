// M1 (C&C's ruling on the clean sign-off; GO item 9; the fix-up of 4 Nov 2026): `signoff[].holds_layer` names the own open objections of a STATED PASS that holds its layer (its row reads signedOff null, objections null, so it says nothing of what holds the layer).
// A seat that signed off blind and then named a defect in a post reads `signedOff: false` with the defect in `objections`, as before (signoff[] is a stable field: `true` means signed off); its blind sign-off lives in panelVerdicts (`signed_off` + `defect_named`).
// One reader (src/decision-records.js holdsLayerOf / holdsLayerWords), used by the exported HTML board and the replay transcript; the field and `panelVerdicts[].defect_named` are declared in the schema (a public contract; additive), with a known-bad input; the documents name both. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as DR from '../src/decision-records.js';   // read through the namespace, so a tree without the reader fails those tests alone and not the whole file
import { renderBoardHtml } from '../src/board-export.js';
import { buildTranscript } from '../src/replay.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const H1 = { id: 'O-aaaaaaaa', criterion: 'It adds no scope the request did not ask for.', problem: 'The plan names a second deliverable nobody asked for.', from_exchange: true };
const H2 = { id: 'O-bbbbbbbb', criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section.', carried_from_round: 2 };

test('holdsLayerOf / holdsLayerWords: the one reader of signoff[].holds_layer - nothing for a row that holds nothing, the ids for one that does', () => {
  assert.deepEqual([DR.holdsLayerOf(undefined), DR.holdsLayerOf({}), DR.holdsLayerOf({ holds_layer: 'O-aaaaaaaa' })], [[], [], []]);
  assert.equal(DR.holdsLayerWords({ signedOff: true, objections: [] }), '');
  assert.equal(DR.holdsLayerWords({ signedOff: null, passed: true, holds_layer: [H1] }), ' (its own objection O-aaaaaaaa still holds back its layer\'s sign-off)');   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `still holds its layer` / `still hold its layer`. NEW: `still holds back its layer's sign-off` / `still hold back its layer's sign-off` (all four pins below). WHY: the reviewed row of src/decision-records.js holdsLayerWords (the apply, commit 1).
  assert.equal(DR.holdsLayerWords({ signedOff: null, passed: true, holds_layer: [H1, H2] }), ' (its own objections O-aaaaaaaa, O-bbbbbbbb still hold back its layer\'s sign-off)');
});

const exportReport = signoff => ({
  runId: '2026-11-04T00-00-00-000Z', chain: 'plan-mini-council', passed: false,
  proposals: [{ id: 'A-1', lab: 'a', title: 'A cheap fix', what: 'Adds a counter.', why: 'It was missing.', how: 'Add a field.', serves: 'evidence item 1', acceptance_test: 'test_a1', withdrawn: false }],
  debate: { posts: [{ by: 'b', on: 'A-1', stance: 'support', text: 'Looks right.' }], replies: [{ id: 'A-1', action: 'keep', text: 'Keeping as written.' }] },
  signoff,
});
const rows = [{ provider: 'a', signedOff: false, objections: [H1] }, { provider: 'b', signedOff: true, objections: [] }, { provider: 'c', signedOff: null, objections: null, passed: true, holds_layer: [H2] }];
test('the exported HTML board says what holds the layer of a stated pass beside its word; a seat that objected and a seat that holds nothing read as before', () => {
  const html = renderBoardHtml(exportReport(rows));
  assert.match(html, /<li>c: abstained \(its own objection O-bbbbbbbb still holds back its layer's sign-off\)<\/li>/);
  assert.match(html, /<li>a: objected<\/li>/, 'a seat that signed off blind and then named a defect reads objected here, as before');
  assert.match(html, /<li>b: signed off<\/li>/);
});

test('the replay transcript says what holds the layer of a stated pass beside its word, and the other seats read as before', () => {
  const steps = buildTranscript(exportReport(rows));
  assert.deepEqual(steps.filter(x => x.kind === 'signoff').map(x => x.text), ['a: objected', 'b: signed off', 'c: abstained (its own objection O-bbbbbbbb still holds back its layer\'s sign-off)']);
});

const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const rowOf = extra => ({ provider: 'a', model: 'm', signedOff: null, objections: null, passed: true, ...extra });
test('schema: holds_layer is declared on the signoff entry (id, criterion and problem; from_exchange or carried_from_round), and a known-bad entry is rejected', () => {
  const validateEntry = new Ajv2020({ strict: false, allErrors: true }).compile({ $defs: schema.$defs, $ref: '#/$defs/signoffEntry' });   // inside the test: a schema that does not compile fails this test alone
  assert.equal(validateEntry(rowOf({ holds_layer: [H1, H2] })), true, JSON.stringify(validateEntry.errors));
  const bad = (name, extra) => assert.equal(validateEntry(rowOf(extra)), false, name);
  bad('an entry with no id', { holds_layer: [{ criterion: 'c', problem: 'p' }] });
  bad('an entry with a key the schema does not declare', { holds_layer: [{ ...H1, severity: 5 }] });
  bad('an empty list', { holds_layer: [] });
  bad('a carried_from_round that is not a pass number', { holds_layer: [{ ...H2, carried_from_round: 0 }] });
  bad('a from_exchange that is not a boolean', { holds_layer: [{ ...H1, from_exchange: 'yes' }] });
});
test('schema: panelVerdicts[].defect_named is declared as a boolean', () => {
  assert.equal(schema.properties.panelVerdicts.items.properties.defect_named?.type, 'boolean');
});
test('schema: the stable signedOff description keeps its old words (signoff[] is a stable field: true means signed off), and holds_layer says it is for a stated pass', () => {
  const props = schema.$defs.signoffEntry.properties;
  assert.equal(props.signedOff.description, 'true: signed off. false: objected (see objections). null: gave no verdict - abstained or stated a pass.');
  assert.match(props.holds_layer.description, /STATED A PASS/);
});

test('the documents name the new fields: AI-README and CHANGELOG say what holds_layer and defect_named are', () => {
  const ai = readFileSync(join(root, 'AI-README.md'), 'utf8'); const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  for (const [name, text] of [['AI-README', ai], ['CHANGELOG', log]]) {
    assert.match(text, /\bholds_layer\b/, `${name} names holds_layer`);
    assert.match(text, /\bdefect_named\b/, `${name} names defect_named`);
  }
});
