// Muad, 23 Oct 2026: "I don't want to see maverick 4 in any chains at all." No chain file the package holds, shipped or retired, names Llama 4 Maverick: not in a seat, a lab, an alternative or a description.
// This reads each file's WHOLE text (wider than the Kimi test, which scans seats only), case-insensitive. A user may still seat the model in a chain of their own. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { everyChainFile } from './helpers/chain-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('no chain file in chains/ or chains/outdated/ names Llama 4 Maverick anywhere in its text', () => {
  const files = everyChainFile(root);
  assert.ok(files.length > 40, `the scan reached the chain files (${files.length})`);
  assert.ok(files.some(f => f.path.includes('outdated')), 'the retired chains are scanned too');
  const hits = files.filter(f => /maverick/i.test(readFileSync(f.path, 'utf8'))).map(f => f.file);
  assert.deepEqual(hits, []);
});
