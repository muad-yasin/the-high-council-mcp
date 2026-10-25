// A real MCP session for the tree tests (0.8.3 M6 S7): spawns `cli.js --mcp` in a working folder, sends the given tools/call requests over stdio JSON-RPC and returns the responses by id (the first call is id 2).
// The server's runs/ is `<cwd>/runs`. $0, offline. Not a test file.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli.js');
// Resolves when the server has EXITED, not when it was told to (src/mcp/advice.js leave() writes a client-cancel STOP request into every advice run the server started, on stdin end, SIGTERM and exit, so a caller that removes its folder right after
// the kill can race that write: the ENOTEMPTY of test/mcp-tool-latency.test.js, 24f2216). Bounded like its waitForChildren: a server that does not exit is named by pid and killed (it is this helper's own spawn), never a hang.
function stopServer(child, ms = 10_000) {
  return new Promise((done, fail) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`the MCP server (pid ${child.pid}) was still running ${ms} ms after it was told to stop`)); }, ms);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.stdin.end(); child.kill();
  });
}
export function mcpCalls(cwd, calls, { timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
    const byId = new Map(); let buf = ''; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}; stderr: ${err}`)); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ } }
      if ([1, ...calls.map((_, i) => i + 2)].every(id => byId.has(id))) { clearTimeout(timer); stopServer(child).then(() => done(byId), fail); }
    });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tree-status-test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
