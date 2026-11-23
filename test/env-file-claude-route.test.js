// 0.8.4 the OpenRouter switch, first group (Builder B): COUNCIL_CLAUDE_ROUTE is OPERATOR-ONLY. It changes where the person's text goes (for a model with no zero-retention host, to a host that may keep it), so a project's .env
// (writable by the project, by an agent, by a cloned repo) must not set it; the flag, the shell variable and the MCP argument stay. Refused through env-file.js's OWN list (not send-profiles.js, which leaves with the add-on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvFile, envFileRefuses } from '../src/env-file.js';

const Route = await import('../src/claude-route.js').catch(() => ({}));      // a dynamic import: on a tree without the module the refusal below is still the first assertion to fail

// EXTENDED (0.8.4 session switch): the same refusal holds for the value `session` (the route that hands the person's text to a Claude Code session and takes the Claude seats off the API): ECR-2. NO RED on an older tree: the file refuses the NAME, whatever the value, so ECR-2 holds on the tree before the session route too (it is a guard that must keep holding, not a new behaviour).
test('ECR-1 COUNCIL_CLAUDE_ROUTE is refused from a project .env, by name and reported once, and the name is the module\'s own constant; names beside it stay allowed', () => {
  assert.equal(envFileRefuses('COUNCIL_CLAUDE_ROUTE'), true, 'the name is on env-file.js\'s own refused list');
  assert.equal(Route.CLAUDE_ROUTE_ENV, 'COUNCIL_CLAUDE_ROUTE', 'the typed name in env-file.js and the module\'s constant are one name');
  const ignored = [], env = {};
  const set = applyEnvFile('COUNCIL_CLAUDE_ROUTE=openrouter\nOPENROUTER_API_KEY=sk-or-v1-fine\nCOUNCIL_CLAUDE_ROUTE=anthropic\nCOUNCIL_CLAUDE_ROUTES=x\nCOUNCIL_CLAUDE=y\nMY_COUNCIL_CLAUDE_ROUTE=z\n', env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored, ['COUNCIL_CLAUDE_ROUTE'], 'named once although written twice');
  assert.equal(env.COUNCIL_CLAUDE_ROUTE, undefined, 'it was not set');
  assert.deepEqual(set.sort(), ['COUNCIL_CLAUDE', 'COUNCIL_CLAUDE_ROUTES', 'MY_COUNCIL_CLAUDE_ROUTE', 'OPENROUTER_API_KEY'], 'and nothing near its name is lost');
});

test('ECR-2 a project .env that says COUNCIL_CLAUDE_ROUTE=session sets nothing and is reported once; the session route stays the operator\'s own choice (the flag, the shell variable, the MCP argument)', () => {
  const ignored = [], env = {};
  const set = applyEnvFile('COUNCIL_CLAUDE_ROUTE=session\nCOUNCIL_CLAUDE_ROUTE= Session \nOPENROUTER_API_KEY=sk-or-v1-fine\n', env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored, ['COUNCIL_CLAUDE_ROUTE'], 'named once although written twice'); assert.equal(env.COUNCIL_CLAUDE_ROUTE, undefined, 'it was not set');
  assert.deepEqual(set, ['OPENROUTER_API_KEY'], 'and the line beside it is not lost');
  const shell = { COUNCIL_CLAUDE_ROUTE: 'session' };
  applyEnvFile('COUNCIL_CLAUDE_ROUTE=anthropic\n', shell);
  assert.equal(shell.COUNCIL_CLAUDE_ROUTE, 'session', 'a project .env cannot move a route the shell chose');
});
