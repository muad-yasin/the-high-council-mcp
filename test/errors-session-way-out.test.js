// 0.8.4 the session route (Helper A): COUNCIL-E001 (src/errors.js, wording row SSW-w12) names the session route as a way out, for the anthropic key only. The E001 text exists on every older tree, so this row goes red at assertion level there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCouncilError } from '../src/errors.js';

test('SWO-1 COUNCIL-E001 for the anthropic key names the session route; for another key it does not', () => {
  const a = formatCouncilError('COUNCIL-E001', { provider: 'anthropic', chain: 'plan-claude-council', envVar: 'ANTHROPIC_API_KEY' });
  assert.match(a, /Set ANTHROPIC_API_KEY in your \.env file\. Or answer the Claude seats with Claude Code sessions of your own: choose the session route \(--claude-route session, or the claude_route argument set to "session"\)\./);
  const o = formatCouncilError('COUNCIL-E001', { provider: 'openrouter', chain: 'plan-daily-7', envVar: 'OPENROUTER_API_KEY' });
  assert.match(o, /Set OPENROUTER_API_KEY in your \.env file\./);
  assert.doesNotMatch(o, /claude-route/);
});
