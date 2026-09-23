// test/cli-hints.test.js
//
// Recovery hints (init's "Next", an external pause, a budget or error stop) are read by people who
// installed from npm, where `node src/cli.js` does not exist. They must name the `council` bin, as
// demo and doctor already do. 2026-09-23 deep check: seven hints in cli.js said `node src/cli.js`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('the bin the hints name is the one package.json installs', () => {
  assert.equal(pkg.bin.council, 'src/cli.js');
});

test('no user-facing string in src/ tells the user to run `node src/cli.js`', () => {
  const offenders = [];
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))) {
    readFileSync(join(root, 'src', f), 'utf8').split('\n').forEach((line, i) => {
      // Comments may describe how the source tree starts the CLI; output may not.
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/node src\/cli\.js/.test(line)) offenders.push(`src/${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
