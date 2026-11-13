// The stage's own instructions for the dispatch bundle (0.8.4 unit 5, plan C item D8). A paused external stage writes NEEDS-<label>.md: a harness header, "## System prompt", the stage's system text, "## User prompt", the user text, an integrity
// footer. prepare_stage_prompt's bundle (src/stage-contract.js renderStagePromptBundle) lists that file under CONTEXT REFERENCES as DATA, so a subagent that is given only the bundle never reads the system text as instructions. This module reads the system text
// out of the NEEDS file for the bundle's own instruction part.
//
// THE TRUST RULE. The NEEDS file is run-folder data: whoever can write the run folder can write it. The system text goes in instruction position only when ALL of these hold, else nothing is added and the bundle is what it was:
//   1. the integrity footer verifies (src/integrity.js: it proves the body was not cut off or damaged; it is an unkeyed hash, so it does NOT prove who wrote the file);
//   2. the file has the harness's own shape: the first "## System prompt" heading, then the first "## User prompt" heading after it;
//   3. the hash of (system, user) as read equals the promptHash the harness recorded in <label>.prompt.json at the pause (the prompt the answer will be held to on resume), so the text is the text the run itself asked for, not a later edit of this one file;
//   4. the system text is not empty and holds no line of the block's own frame (the marker lines the held block puts round it), so a planted marker line cannot close the block early. There is NO length cap: no measured size backs a number.
// WHAT RULE 3 PROVES, AND WHAT IT DOES NOT. It proves the text is the system text the run sent for this stage, the same text a model seat in this seat gets. It does not prove the harness alone wrote it: a seat's role.persona and its persona-file voice, and a
// judge's persona under the voice form, come from the chain file or the persona file (the person's own configuration), so they can be in it. No text a model wrote and no run-derived text (task, draft, objection, memory block) is in a system text: those go in
// the user prompt (traced for every stage kind src/stage-contract.js stageKindOf recognises, in the unit's report; a label it does not recognise gets no bundle at all). A tree member's chain is the chain file the tree registered by sha256, not a parent's plan.
// LIMIT, stated once: 1 and 3 are two files in the same run folder, so a writer of both can pass them. The bundle already puts the task text in instruction position, read from the path run.json records, so this adds no new kind of trust, only the same
// kind for the stage's own words. The words around the system text are HELD (test/held-prompts/held-084-c.js stageInstructionsBlock): until src/roles.js records them, held() returns nothing, this returns null and every bundle is byte-identical to today's.
import { verifiedBody } from './integrity.js';
import { promptHashOf } from './cache-integrity.js';
import { held } from './held-roles.js';

const SYSTEM_HEAD = '\n## System prompt\n\n';
const USER_HEAD = '\n\n## User prompt\n\n';

/** { system } when the NEEDS file text passes rules 1-3 and the non-empty check against the prompt record's text, else { refused: <why> }. Pure: no file is read here. Rule 4's frame check is stageInstructionsOf's. */
export function verifiedSystemOfNeeds(needsText, promptRecordText) {
  const body = verifiedBody(needsText);
  if (body === null) return { refused: 'integrity' };
  const at = body.indexOf(SYSTEM_HEAD);
  if (at < 0) return { refused: 'shape' };
  const rest = body.slice(at + SYSTEM_HEAD.length);
  const cut = rest.indexOf(USER_HEAD);
  if (cut < 0) return { refused: 'shape' };
  const system = rest.slice(0, cut);
  const user = rest.slice(cut + USER_HEAD.length);
  let record = null;
  try { record = JSON.parse(promptRecordText); } catch { /* no record: refused below */ }
  if (!record || typeof record !== 'object' || record.provider !== 'external' || typeof record.promptHash !== 'string') return { refused: 'no-record' };
  if (promptHashOf(system, user) !== record.promptHash) return { refused: 'hash' };
  if (!system.trim()) return { refused: 'empty' };
  return { system };
}

/** The bundle's instruction part for a stage, or null (held words not recorded yet, or a rule above refused). */
export function stageInstructionsOf(needsText, promptRecordText) {
  const render = held('stageInstructionsBlock');
  if (!render) return null;
  const v = verifiedSystemOfNeeds(needsText, promptRecordText);
  if (v.refused) return null;
  const frame = String(render({ system: '' }) ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  if (v.system.split('\n').some(l => frame.includes(l.trim()))) return null;
  const text = render({ system: v.system });
  return typeof text === 'string' && text ? text : null;
}
