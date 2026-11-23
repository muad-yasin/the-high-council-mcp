// 0.8.4 D38 (C&C 09 Nov 2026, condition on the MCP strip): no behaviour of the MCP SDK is asserted from memory. A tool whose schema is the one submit_stage builds for `session_reads` (src/excerpt-channel.js
// sessionReadsSchemaFields), driven through the SDK's own server and client: while the words are held the schema does not list the field and a call that sends it gets a handler that receives NO such key (the SDK
// drops it before the handler runs, so the refusal in submitStageAnswer is not reached through the tool and is the backstop for the command's own path); with the words recorded the field is listed and passed on.
// Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setHeldForTest } from '../src/held-roles.js';
import { sessionReadsSchemaFields } from '../src/excerpt-channel.js';
import { excerptsBlock, sessionReadsField } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const WORDS = { excerptsBlock, sessionReadsField };
const HELD = { excerptsBlock: undefined, sessionReadsField: undefined };
const reads = [{ path: 'src/a.js', lines: '3-5', why: 'To check the retry claim.' }];

async function drive(args) {
  const received = [];
  const server = new McpServer({ name: 'strip-test', version: '0' });
  server.tool('submit', 'A stage answer.', { run: z.string(), content: z.string(), ...sessionReadsSchemaFields(z) }, async a => { received.push(a); return { content: [{ type: 'text', text: 'ok' }] }; });
  const client = new Client({ name: 'c', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'submit', arguments: args });
    return { listed: Object.keys(tools[0].inputSchema.properties), received, result };
  } finally { await client.close(); await server.close(); }
}

test('words held: the field is not listed, and a call that sends it reaches the handler without it', async () => {
  setHeldForTest(HELD);
  const { listed, received, result } = await drive({ run: 'r', content: 'The plan.', session_reads: reads });
  assert.deepEqual(listed, ['run', 'content']);
  assert.equal(received.length, 1);
  assert.equal('session_reads' in received[0], false, 'the handler receives no session_reads');
  assert.equal(Boolean(result.isError), false);
});

test('words recorded: the field is listed and the handler receives it', async () => {
  setHeldForTest(WORDS);
  const { listed, received } = await drive({ run: 'r', content: 'The plan.', session_reads: reads });
  assert.deepEqual(listed, ['run', 'content', 'session_reads']);
  assert.deepEqual(received[0].session_reads, reads);
});
