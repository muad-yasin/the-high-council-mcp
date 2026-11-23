// 0.8.4 S16 (D part b; Q4(d), Q9(e), CA1, T13o T13r T21an T21ax T4l T4m): the continues made at the stops for a seat that gave no usable reply (a layer-bound stop with the reason `unheard`, and the final-read stop). Pure; no imports.
// c_u = 2: the HANDLING SESSION's continues at stops of this kind in a run in all. Past it a further continue reaches the person only through the session's and its advisor's finding that it is the person's decision (step `defer`).
// n_u: every continue at these stops, the person's included; DERIVED from run.json `roundChoices`, never recorded or printed as a figure of its own (the price per continue is call-ceiling.js untilNoReply).
// The entry's `actor` says who chose: `handling_session` counts toward c_u; anything else (a typed terminal choice is `unknown`, the person's) counts in n_u only.
export const C_U = 2;
export const isNoReplyStop = stop => stop?.kind === 'layer_bound' && (stop.why === 'unheard' || stop.why === 'final_read');
const isNoReplyChoice = c => c?.kind === 'layer_bound' && (c.why === 'unheard' || c.why === 'final_read');
/** -> { total (n_u), bySession (toward c_u), byPerson } */
export function noReplyContinues(made) {
  const cs = (Array.isArray(made) ? made : []).filter(c => c?.choice === 'continue' && isNoReplyChoice(c));
  const bySession = cs.filter(c => c.actor === 'handling_session').length;
  return { total: cs.length, bySession, byPerson: cs.length - bySession };
}
/** The session may continue on its own authority while it has made fewer than c_u of them at stops of this kind. */
export const sessionMayContinue = made => noReplyContinues(made).bySession < C_U;
/**
 * T4m / T4l: at the Q4(d) corner (a layer-1 stop for a silent seat, a layer-1 objection standing not_debated), before the count, the session's finish is the person's decision (E3(a)): refused, with defer as the way. `objections` is the open list of the stopped run's last
 * critique, or null when it cannot be read (fail closed). A layer-1 unheard stop with no objection standing keeps the session's finish.
 */
export const sessionFinishNeedsFinding = (stop, made, objections) => stop?.kind === 'layer_bound' && stop.why === 'unheard' && stop.layer === 1 && sessionMayContinue(made) && (objections === null || (Array.isArray(objections) && objections.length > 0));
/**
 * What the handling session may choose at a stop, given the choices the stop offers (`base`). At a stop for a seat that gave no usable reply: no `continue` once c_u are made; at the final-read stop no `finish` once the one read before a finish was made;
 * and the corner's finish rule above. -> { choices, continueSpent, finishNeedsFinding }. Pure.
 */
export function sessionChoicesAt(stop, made, objections, base) {
  const noReply = isNoReplyStop(stop);
  const continueSpent = noReply && !sessionMayContinue(made);
  const finishRead = stop?.kind === 'layer_bound' && stop.why === 'final_read' && stop.finish_read_used === true;
  const choices = noReply ? base.filter(c => !(c === 'continue' && continueSpent) && !(c === 'finish' && finishRead)) : base;
  const finishNeedsFinding = sessionFinishNeedsFinding(stop, made, objections);
  return { choices: finishNeedsFinding ? choices.filter(c => c !== 'finish') : choices, continueSpent, finishNeedsFinding };   // the quote offers what the answer accepts (the specific refusal still fires for a finish sent anyway)
}
