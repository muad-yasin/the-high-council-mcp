// 0.8.4 the Claude route, WIRING (Builder B): the screen that asks for the spending limit says the Claude seats go through OpenRouter (buildCapScreen's `route`, one line before the limit paragraph), and a screen with no route is byte for byte what it was.
// A-DRAFT: the line is routeLines' (src/claude-route.js, wording row SW2-w3/w4); this test passes the text through, it does not retype it. RED on the tree before this unit: CS-1 fails at its first assertion (the line is not in the text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapScreen } from '../src/cap-screen.js';
const CR = await import('../src/claude-route.js').catch(() => ({}));      // a namespace read: on the tree before this unit the missing export fails at an assertion, not at load

const base = { kind: 'run', subject: { chain: 'plan-mini-council', task: 'tasks/x.md' }, estimate: { usd: 1.5, scope: 'this run' }, maximum: { usd: 4 } };

test('CS-1: with a route line the text carries it once, after the figures and before the limit paragraph; without one the text is what it was', () => {
  assert.equal(typeof CR.routeLines, 'function', 'src/claude-route.js exports routeLines');
  const line = CR.routeLines({ route: 'openrouter', why: 'no_anthropic_key', routed: [{}, {}] })[0];
  assert.ok(line && line.includes('OpenRouter'), 'premise: routeLines has a line to show');
  const plain = buildCapScreen(base).text;
  const routed = buildCapScreen({ ...base, route: line }).text;
  assert.ok(routed.includes(line), 'the line is on the screen');
  assert.equal(routed.split(line).length, 2, 'once');
  assert.equal(routed.replace(`${line}\n`, ''), plain, 'removing the line gives the plain screen exactly');
  assert.ok(routed.indexOf(line) > routed.indexOf('Estimate:') && routed.indexOf(line) < routed.indexOf('Your limit'), 'after the estimate, before the limit paragraph');
  assert.equal(buildCapScreen({ ...base, route: null }).text, plain, 'a null route changes nothing');
  // the verb agrees with the number: a mock chain with the security review on routes exactly one seat (the default reviewer)
  const one = CR.routeLines({ route: 'openrouter', why: 'no_anthropic_key', routed: [{}] })[0], oneChosen = CR.routeLines({ route: 'openrouter', why: 'chosen', routed: [{}] })[0];
  assert.match(one, /^Claude seats: 1 Claude seat goes through OpenRouter, because no ANTHROPIC_API_KEY is set\. It is billed at OpenRouter's prices\./);
  assert.match(oneChosen, /^Claude seats: 1 Claude seat goes through OpenRouter, as you chose\. It is billed at OpenRouter's prices\.$/);
  assert.match(line, /^Claude seats: 2 Claude seats go through OpenRouter, because /);
  assert.deepEqual(CR.routeLines({ route: 'anthropic', why: 'default', routed: [] }), [], 'a direct run has no line to show');
  // a dry run that a key state would have stopped as a start names the route it priced, and nothing about the key
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `Claude seats: priced straight to Anthropic.` NEW: `Claude seats: priced as calls straight to Anthropic.` (K5). WHY: the reviewed route line of src/claude-route.js:152.
  assert.deepEqual(CR.routeLines({ route: 'anthropic', why: 'key_state', routed: [] }), ['Claude seats: priced as calls straight to Anthropic.']);
  assert.deepEqual(CR.routeLines({ route: 'anthropic', why: 'recorded', routed: [] }), ['Claude seats: priced as calls straight to Anthropic.'], 'an existing direct run priced while the keys would choose the other way');
  // the line under it when the real resume would stop on a key (SW2-w19)
  assert.deepEqual(CR.resumeStopLines({ stopNote: 'X is set, but it is bad. Nothing was started and nothing was spent.' }), ['A real resume of this run stops here: X is set, but it is bad. Nothing was started and nothing was spent.']);
  assert.deepEqual(CR.resumeStopLines({}), []); assert.deepEqual(CR.resumeStopLines(), []);
  assert.deepEqual(CR.resumeStopLines({ stopNote: 'S.' }, 'rematch'), ['A real rematch of this run stops here: S.']); assert.deepEqual(CR.resumeStopLines({ stopNote: 'S.' }, 'replay'), ['A real replay of this run stops here: S.']);
  // an existing run that began through OpenRouter, priced on that route (SW2-w18): exact, one seat and several
  assert.deepEqual(CR.routeLines({ route: 'openrouter', why: 'recorded', routed: [{}] }), ["Claude seats: 1 Claude seat goes through OpenRouter, as this run began. It is billed at OpenRouter's prices."]);
  assert.deepEqual(CR.routeLines({ route: 'openrouter', why: 'recorded', routed: [{}, {}, {}] }), ["Claude seats: 3 Claude seats go through OpenRouter, as this run began. They are billed at OpenRouter's prices."]);
});

// 0.8.4 session switch (Agent B): the screen of a chain that still bills carries the session line (SSW-w1, A-DRAFT, asserted WHOLE) once, between the figures and the limit paragraph, so the person who types the limit reads what it is for. On a tree before the session route routeLines
// returns [] for it: the first assertion fails (a string is asserted before it is used), no TypeError.
test('CS-2: a session route line is on the limit screen once, whole, before the limit paragraph; one seat, several seats, with and without a paid seat left', () => {
  assert.equal(typeof CR.routeLines, 'function');
  const mixed = CR.routeLines({ route: 'session', why: 'chosen', routed: [{}, {}, {}], stillBilling: [{ role: 'critics[1]', provider: 'openrouter' }] })[0];
  assert.equal(mixed, 'Claude seats: 3 Claude seats are answered by your own Claude Code sessions, one session for each seat (no API cost for them). 1 other seat still bills through openrouter: critics[1]. The spending limit asked for covers it.');
  assert.equal(typeof mixed, 'string');
  const plain = buildCapScreen(base).text; const screen = buildCapScreen({ ...base, route: mixed }).text;
  assert.equal(screen.split(mixed).length, 2, 'once'); assert.equal(screen.replace(`${mixed}\n`, ''), plain, 'removing the line gives the plain screen exactly');
  assert.ok(screen.indexOf(mixed) > screen.indexOf('Estimate:') && screen.indexOf(mixed) < screen.indexOf('Your limit'), 'after the estimate, before the limit paragraph');
  assert.deepEqual(CR.routeLines({ route: 'session', why: 'chosen', routed: [{}], stillBilling: [] }), ['Claude seats: 1 Claude seat is answered by your own Claude Code session, one session for each seat (no API cost for it).']);
  assert.deepEqual(CR.routeLines({ route: 'session', why: 'recorded', routed: [{}, {}] }), ['Claude seats: 2 Claude seats are answered by your own Claude Code sessions, one session for each seat (no API cost for them).'], 'a resumed session run says the same line');
  assert.deepEqual(CR.routeLines({ route: 'session', why: 'chosen', routed: [{}], stillBilling: [{ role: 'proposers[0]', provider: 'openrouter' }, { role: 'critics[2]', provider: 'google' }, { role: 'critics[3]', provider: 'openrouter' }] }),
    ['Claude seats: 1 Claude seat is answered by your own Claude Code session, one session for each seat (no API cost for it). 3 other seats still bill through openrouter and google: proposers[0], critics[2], critics[3]. The spending limit asked for covers them.']);
});
