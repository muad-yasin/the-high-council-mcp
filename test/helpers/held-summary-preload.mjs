// A test seam for a SPAWNED CLI (`node --import <this file> src/cli.js summary-add ...`): the held instruction of the summary block is injected the way setHeldForTest does it in process, so the real verb can be driven while the wording is not recorded in src/roles.js.
import { setHeldForTest } from '../../src/held-roles.js';
import { handlerSummaryInstruction, handlerSummaryEndLine } from '../held-prompts/held-084-summary.js';
setHeldForTest({ handlerSummaryInstruction, handlerSummaryEndLine });
