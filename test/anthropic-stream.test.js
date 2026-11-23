// 0.8.4 long direct Claude calls (Helper A): a direct Anthropic call is STREAMED (`stream: true`), so the answer's headers arrive at once and Node's 300 s wait for headers never ends a long call. The stream is rebuilt into the
// very object a non-streaming call returns (src/providers.js readMessageStream), so the usage, the stop reason and the cut-off reading are unchanged.
// PINNED: the rebuilt message equals the non-streaming fixture (thinking block with its signature, text, stop reason, usage with the cache counts), whatever the chunking and the line ends; callAnthropic returns the same
// text/usage/stop for the stream and for the JSON fixture; its request keeps model, max_tokens (128,000) and the high effort and adds `stream: true`; an `error` event after the 200 and a stream that ends early are POSSIBLY BILLED and
// never re-sent; a refused connection is NOT billed (and is retried as before); a 200 that is not an event stream is still read as JSON; the OpenAI-compatible adapter's request is unchanged (no `stream`).
// Every provider name is imported through a namespace so that a tree without the change fails row by row. No network: fetch is replaced in every row (no key reaches a host).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/providers.js';

const realFetch = globalThis.fetch; const savedKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => { globalThis.fetch = realFetch; P.setRetrySleep(null); if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });

// The shape is the DOCUMENTED stream (https://platform.claude.com/docs/en/build-with-claude/streaming, read 10 Nov 2026): message_start carries the input and cache counts, a message_delta carries the cumulative `output_tokens` ONLY. No thinking count is documented there.
const USAGE = { input_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, output_tokens: 30 };
const NONSTREAM = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'thinking', thinking: 'thinking', signature: 'sig' }, { type: 'text', text: 'Hello world' }],
  stop_reason: 'end_turn', stop_sequence: null, usage: USAGE,
};
const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const START = ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, output_tokens: 1 } } });
const PING = ev('ping', {});
const BODY = [
  PING,
  ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'th' } }), PING,
  ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'inking' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
  ev('content_block_stop', { index: 0 }),
  ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Hello ' } }),
  ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'world' } }),
  ev('content_block_stop', { index: 1 }),
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } }),
];
const STOP = ev('message_stop', {});
const FULL = START + BODY.join('') + STOP;

/** A Response whose body arrives in pieces of `size` bytes (a piece can end inside an event or inside a multi-byte character). */
function sseResponse(text, { size = 7, status = 200, type = 'text/event-stream' } = {}) {
  const bytes = new TextEncoder().encode(text); let at = 0;
  const body = new ReadableStream({ pull(c) { if (at >= bytes.length) { c.close(); return; } c.enqueue(bytes.slice(at, at + size)); at += size; } });
  return new Response(body, { status, headers: { 'content-type': type } });
}
const jsonResponse = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
const OPTS = { model: 'claude-opus-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 128000, extra: { output_config: { effort: 'high' } } };
function stub(make) { const seen = []; globalThis.fetch = async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return make(seen.length); }; process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy-key-0123456789'; return seen; }
const readStream = res => P.readMessageStream(res);

test('AS-1 readMessageStream rebuilds the non-streaming message exactly: thinking with its signature, text, stop reason, usage with the cache counts; any chunking and CRLF line ends', async () => {
  for (const size of [1, 7, 64, 100000]) assert.deepEqual(await readStream(sseResponse(FULL, { size })), NONSTREAM, `pieces of ${size} bytes`);
  assert.deepEqual(await readStream(sseResponse(FULL.replace(/\n/g, '\r\n'), { size: 5 })), NONSTREAM, 'CRLF line ends');
  const accented = FULL.replace('Hello ', 'Héllo 世');
  assert.equal((await readStream(sseResponse(accented, { size: 3 }))).content[1].text, 'Héllo 世world', 'a multi-byte character cut between two pieces is kept whole');
});

test('AS-2 callAnthropic: the stream and the JSON fixture give the same reply; the request keeps model, max_tokens 128,000 and the high effort, adds stream: true, and goes to the Anthropic URL', async () => {
  const seen = stub(() => sseResponse(FULL));
  const viaStream = await P.call('anthropic', OPTS);
  assert.equal(seen.length, 1); assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0].body.stream, true, 'the call is streamed'); assert.equal(seen[0].body.max_tokens, 128000); assert.equal(seen[0].body.model, 'claude-opus-5-5');
  assert.deepEqual(seen[0].body.output_config, { effort: 'high' }, 'the effort is never touched');
  const seenJson = stub(() => jsonResponse(NONSTREAM));
  const viaJson = await P.call('anthropic', OPTS);
  assert.equal(seenJson.length, 1);
  assert.deepEqual(viaStream, viaJson, 'text, usage (cache counts) and stop read identically');
  assert.equal(viaStream.text, 'Hello world'); assert.equal(viaStream.usage.thinking, 0, 'a stream that gives no thinking count and has text: 0, as a reply without the count'); assert.equal(viaStream.usage.output, 30); assert.equal(viaStream.usage.cacheRead === undefined, true, 'a call without cache keeps the usage object it always had');
});

test('AS-3 an `error` event after the 200 is a possibly billed failure, flagged provider_body, never re-sent', async () => {
  P.setRetrySleep(async () => {});
  const seen = stub(() => sseResponse(START + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })));
  await assert.rejects(P.call('anthropic', OPTS), err => err.maybeBilled === true && err.causeClass === 'provider_body' && err.providerCode === 'overloaded_error' && /overloaded_error/.test(err.message) && /not retried/.test(err.message) && /already billed/.test(err.message));
  assert.equal(seen.length, 1, 'a possibly billed call is not sent again');
});

test('AS-4 a stream that ends before message_stop is a possibly billed dropped reply (transport), never re-sent by the adapter', async () => {
  P.setRetrySleep(async () => {});
  const seen = stub(() => sseResponse(START + BODY.slice(0, 5).join('')));
  await assert.rejects(P.call('anthropic', OPTS), err => err.maybeBilled === true && err.causeClass === 'transport' && /connection dropped while reading a 200 response/.test(err.message));
  assert.equal(seen.length, 1);
});

test('AS-5 a refused connection is NOT billed and is retried as before; a 429 is still an HTTP status error', async () => {
  P.setRetrySleep(async () => {});
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', syscall: 'connect' } }); };      // the connect-stage syscall is what proves nothing was sent (failedBeforeSend)
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy-key-0123456789';
  await assert.rejects(P.call('anthropic', OPTS), err => !err.maybeBilled);
  assert.ok(calls >= 2, `a refused connection is retried: ${calls}`);
  const seen = stub(() => new Response('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}', { status: 429, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(P.call('anthropic', OPTS), err => /429/.test(err.message) && !err.maybeBilled);
  assert.ok(seen.length >= 1);
});

test('AS-6 a 200 that is not an event stream is read as JSON, as before; the OpenAI-compatible adapter is not streamed', async () => {
  stub(() => jsonResponse(NONSTREAM));
  assert.equal((await P.call('anthropic', OPTS)).text, 'Hello world');
  const seen = []; globalThis.fetch = async (url, init) => { seen.push(JSON.parse(init.body)); return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  await P.call('ollama', { model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, baseUrl: 'http://127.0.0.1:9' });
  assert.equal(seen.length, 1); assert.equal('stream' in seen[0], false, 'no `stream` field for another provider');
});

test('AS-7 Node\'s 300 s wait between two pieces of a stream (UND_ERR_BODY_TIMEOUT) is possibly billed, flagged timedOut and NOT asked again; an ordinary dropped stream still may be', async () => {
  P.setRetrySleep(async () => {});
  const bytes = new TextEncoder().encode(START + BODY.slice(0, 3).join('')); let sent = false;
  const body = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(bytes); return; } c.error(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('Body Timeout Error'), { code: 'UND_ERR_BODY_TIMEOUT' }) })); } });
  const seen = stub(() => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  let caught; await assert.rejects(P.call('anthropic', OPTS), err => { caught = err; return err.maybeBilled === true && err.causeClass === 'transport'; });
  assert.equal(caught.timedOut, true, 'flagged as a timeout'); assert.equal(P.isAutoResumable(caught), false, 'a silence that long would be as long again: not asked again');
  assert.equal(seen.length, 1);
  stub(() => sseResponse(START + BODY.slice(0, 5).join('')));
  let dropped; await assert.rejects(P.call('anthropic', OPTS), err => { dropped = err; return true; });
  assert.equal(P.isAutoResumable(dropped), true, 'an ordinary dropped stream is still asked again, as a dropped reply was');
});

test('AS-8 the thinking count: a message_delta that carries one is kept; a reply that is ALL thinking (a thinking block, no text) with no count gets every output token as its thinking, so the bigger-cap retry still sees it; a reply with text and no count stays 0', async () => {
  const withDetails = FULL.replace('"usage":{"output_tokens":30}', '"usage":{"output_tokens":30,"output_tokens_details":{"thinking_tokens":10}}');
  assert.notEqual(withDetails, FULL);
  stub(() => sseResponse(withDetails));
  assert.equal((await P.call('anthropic', OPTS)).usage.thinking, 10, 'the count the stream carries is the count');
  const thoughtOnly = START + ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } }) + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 128000 } }) + STOP;
  stub(() => sseResponse(thoughtOnly));
  const cut = await P.call('anthropic', OPTS);
  assert.equal(cut.usage.stop, P.normaliseStop('max_tokens'), 'the stop reason is read as before'); assert.equal(cut.text, ''); assert.equal(cut.usage.output, 128000); assert.equal(cut.usage.thinking, 128000, 'all of the output went to thinking');
  stub(() => sseResponse(FULL));
  assert.equal((await P.call('anthropic', OPTS)).usage.thinking, 0, 'text and no count: not known, 0');
});
