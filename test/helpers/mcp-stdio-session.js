// One MCP stdio session against `council --mcp` in a project folder (0.8.4 D5a tests): the calls in order, each answer parsed. A JSON-RPC error or an answer that is not JSON fails at once with its text (no waiting for a timeout).
// The server child gets malformed provider keys (test/no-paid-chain-spawn.test.js): the tests are $0.
import { spawn } from 'node:child_process';
import { cli } from './round-stop-project.js';
import { malformedProviderKeys } from './no-real-keys.js';

export function session(cwd, calls, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const answers = []; let buf = ''; let next = 0; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out after ${answers.length} answers; stderr: ${err}`)); }, timeoutMs);
    const send = m => child.stdin.write(`${JSON.stringify(m)}\n`);
    const sendNext = () => {
      if (next >= calls.length) { clearTimeout(timer); child.stdin.end(); child.kill(); return done(answers); }
      send({ jsonrpc: '2.0', id: next + 2, method: 'tools/call', params: calls[next++] });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); sendNext(); }
        else if (m.id !== undefined && m.error) { clearTimeout(timer); child.kill(); fail(new Error(`JSON-RPC error: ${JSON.stringify(m.error)}; stderr: ${err}`)); }
        else if (m.id !== undefined) { try { answers.push(JSON.parse(m.result.content[0].text)); } catch { clearTimeout(timer); child.kill(); fail(new Error(`not a JSON answer: ${JSON.stringify(m.result).slice(0, 300)}`)); return; } }
        if (m.id !== undefined && m.id !== 1 && !m.error) sendNext();
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stop-decide-test', version: '0' } } });
  });
}
