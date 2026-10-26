// test/lab-unsafe.test.js
//
// BUG-D-021 (bug audit 24 Okt 2026): a seat's lab is written into the file name of every stage it answers. A lab with a path separator, a dot-only name or a control character
// must be refused by the lint (a finding) and by invoke() before anything is read, written, sent or paid. A lab with a space or "+" stays valid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lintChain } from '../src/chain-lint.js';
import { runChain, setPromptSpy } from '../src/chain.js';
import { labProblem, labUnsafeMessage, labSuggestion, assertStageLabelSafe } from '../src/lab-safety.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
const withCriticLab = lab => ({ ...mockConfig, seats: { ...mockConfig.seats, critics: mockConfig.seats.critics.map((c, i) => (i === 0 ? { ...c, lab } : c)) } });
const unsafe = (f, kind = 'lab-unsafe') => f.filter(x => x.kind === kind);

test('labProblem names what is wrong, and accepts a lab with a space, a plus sign or dots', () => {
  assert.equal(labProblem('x/../../../CLAUDE'), 'a path separator');
  assert.equal(labProblem('a\\b'), 'a path separator');
  assert.equal(labProblem('a\u0000b'), 'a control character');
  assert.equal(labProblem('a\nb'), 'a control character');
  assert.equal(labProblem('..'), '".."');
  assert.equal(labProblem('.'), '"."');   // FX-009: named by its own value, not as ".."
  for (const ok of ['glm', 'my lab+1', 'a..b', 'claude-opus-5.5', 'Gemini_2', 'été']) assert.equal(labProblem(ok), null, ok);
  assert.equal(labProblem(undefined), null);
  assert.equal(labProblem(5), null);
});

test('lint: a critic lab with a path separator is a lab-unsafe finding that names the slot, the lab and a plain suggestion', () => {
  const findings = unsafe(lintChain(withCriticLab('x/../../../CLAUDE'), 'chains/fixture.json'));
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /^seats\.critics names the lab "x\/\.\.\/\.\.\/\.\.\/CLAUDE", which contains a path separator and so cannot be part of a file name\. The lab is written into the stage file names of every run\.$/);
  assert.match(findings[0].fix, /for example "x-\.\.-\.\.-\.\.-CLAUDE"/);
  assert.match(findings[0].fix, /\(letters, digits, "-", "_" and "\." are fine; a lab that is only "\." or "\.\." is not\)\.$/);   // FX-009: the dot is fine in a lab, the two dot-only names are not
  assert.equal(labSuggestion('x/../../../CLAUDE'), 'x-..-..-..-CLAUDE');
  assert.equal(labProblem(labSuggestion('x/../../../CLAUDE')), null, 'the suggestion is itself valid');
  assert.equal(labSuggestion('..'), 'seat');
});

test('lint: a lab that is exactly ".." or "." is named by its own value in the sentence (FX-009: the lab "." used to be said to contain "..")', () => {
  assert.equal(unsafe(lintChain(withCriticLab('..'), 'chains/fixture.json'))[0]?.message, 'seats.critics names the lab "..", which contains ".." and so cannot be part of a file name. The lab is written into the stage file names of every run.');
  assert.equal(unsafe(lintChain(withCriticLab('.'), 'chains/fixture.json'))[0]?.message, 'seats.critics names the lab ".", which contains "." and so cannot be part of a file name. The lab is written into the stage file names of every run.');
});

test('lint: a clean lab, a lab with a space and every shipped chain give no lab-unsafe finding', () => {
  assert.deepEqual(unsafe(lintChain(withCriticLab('my lab+1'), 'chains/fixture.json')), []);
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    assert.deepEqual(unsafe(lintChain(config, `chains/${f}`)), [], f);
  }
});

test('lab-safety: the run-time sentence is the lint sentence with the stage as its subject', () => {
  assert.throws(() => assertStageLabelSafe('panel-1-x/../../CLAUDE', 'x/../../CLAUDE'),
    e => e.message === labUnsafeMessage('stage "panel-1-x/../../CLAUDE"', 'x/../../CLAUDE', 'a path separator'));
  assert.doesNotThrow(() => assertStageLabelSafe('panel-1-glm', 'glm'));
  assert.throws(() => assertStageLabelSafe('panel-1-x/y', 'x/y'), e => e.controlFlow === true, 'control flow: no seat-level catch may turn it into an abstention');
  assert.throws(() => assertStageLabelSafe('a/b', 'glm'), /contains a path separator/);   // a label that is unsafe although the lab is not
});

test('runChain with degrade_on_provider_error still refuses (the guard is control flow, not a seat that is down)', async () => {
  await assert.rejects(runChain({ request: 'a request', config: { ...withCriticLab('x/y'), degrade_on_provider_error: true }, log: () => {} }), /contains a path separator/);
});

test('runChain: a chain whose critic lab is "x/../../escape" is refused by invoke() before the critic is called (its prompt is never built; the stage label need not contain the lab)', async () => {
  const seen = [];
  setPromptSpy(p => seen.push(p.label));
  try {
    await assert.rejects(
      runChain({ request: 'a request', config: withCriticLab('x/../../escape'), log: () => {} }),
      /^Error: stage "[^"]+" names the lab "x\/\.\.\/\.\.\/escape", which contains a path separator and so cannot be part of a file name/,
    );
  } finally { setPromptSpy(null); }
  assert.ok(!seen.some(l => l.includes('/')), `no stage with an unsafe label was started: ${seen.join(', ')}`);
});
