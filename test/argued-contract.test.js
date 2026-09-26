// The argued stage's contract names the headings the argued prompt asks for and argued.js checks
// (bug audit 2026-09-26 #6). stage-contract.js had its own typed-out list, which had drifted: it
// required "The objections that changed the plan" where the prompt and the checker say "The
// objections and how the authors answered", so the stage bundle and completeness checks asked for
// a heading the real prompt never requests. The contract now reads ARGUED_SECTIONS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStageContract } from '../src/stage-contract.js';
import { ARGUED_SECTIONS, ARGUED_SYSTEM } from '../src/argued.js';

test('the argued contract\'s sections are the title plus ARGUED_SECTIONS, each a heading in the argued prompt', () => {
  const contract = buildStageContract({ argued: { enabled: true }, seats: {} }, 'argued');
  assert.deepEqual(contract.deliverable_format.required_sections, ['How this plan was argued', ...ARGUED_SECTIONS]);
  for (const s of contract.deliverable_format.required_sections) {
    assert.match(ARGUED_SYSTEM, new RegExp(`^#{1,2} ${s}$`, 'm'), `"${s}" is a heading the prompt asks for`);
  }
});
