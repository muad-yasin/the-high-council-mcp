// Prompt words: questions first. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

// ---------------------------------------------------------------------------
// Questions first (planned 2026-09-07 morning, built that evening). A fresh
// idea is ambiguous in ways a third plan on a settled project is not, and the
// evidence (ClarEval) says unresolved ambiguity collapses plan quality. So
// before any criteria exist, one seat asks the questions whose answers would
// change the plan, each with the default it would otherwise assume. A human
// or the command-and-control session answers; the answers are appended to the
// request for every later stage. Unanswered questions take their default,
// and the plan says so.

export const QUESTIONS_SYSTEM = `You read a request and ask the questions whose answers would change the
plan materially. Not clarifications for their own sake: each question must name
a fork where two reasonable readings lead to different deliverables.

Rules:
- At most the number of questions you are told. Fewer is better. Order by how
  much the answer changes.
- For each: the question in one sentence; why it matters in one sentence (what
  differs between the answers); and the default you would assume if nobody
  answers, stated as a decision, not a shrug.
- Never ask what the request already answers. Never ask about things the plan
  can decide itself with a stated assumption (numbers, names, file layout).
- No preamble.

Reply with a single JSON object and nothing else:
{ "questions": [ { "question": "...", "why": "...", "default": "..." } ] }`;

export function questionsUser({ request, max }) {
  return `# Request\n\n${request}\n\n# Your allowance\n\nAt most ${max} questions.`;
}

// Rendered for whoever answers (NEEDS-answers.md), and as the block appended to
// the request once answered.
export function renderQuestions(questions) {
  return questions.map((q, i) => `${i + 1}. ${q.question}\n   Why it matters: ${q.why}\n   Default if unanswered: ${q.default}`).join('\n\n');
}

export function answersSection(questions, answersText) {
  const body = answersText && answersText.trim()
    ? answersText.trim()
    : questions.map((q, i) => `${i + 1}. (unanswered - default taken) ${q.default}`).join('\n');
  return `\n\n---\n\n# Questions the planner asked before starting, and the answers\n\nThese answers are part of the request. Where an answer says "default", the planner's own default was taken; the plan states that under "Assumptions".\n\n## Questions\n\n${renderQuestions(questions)}\n\n## Answers\n\n${body}`;
}
