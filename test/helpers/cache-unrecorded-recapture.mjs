// Prints the pin fixture test/fixtures/cache-unrecorded-f039a88a.json with its `synthetic` and `shipped` figures recomputed on THIS tree (its `configs`, the parent's own chain files, are kept). Run on the box:
//   node test/helpers/cache-unrecorded-recapture.mjs > cache-unrecorded-new.json
// Why: the pin compared the unrecorded-state dry run with the parent f039a88a; the ladder unit moved the layer-1 exchange from 7 to 3 rounds and added the solo ask's rows, and C&C's ruling B number (a 1-hour marker needs 4 rounds) moved the marked rows, so the parent's figures are no longer the reference; the pin keeps its job (nothing in the unrecorded state drifts) against the figures of this tree.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unrecordedFigures } from './cache-unrecorded-figures.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(readFileSync(new URL('../fixtures/cache-unrecorded-f039a88a.json', import.meta.url), 'utf8'));
const now = JSON.parse(JSON.stringify(unrecordedFigures(root, fixture.configs)));
process.stdout.write(JSON.stringify({ synthetic: now.synthetic, shipped: now.shipped, configs: fixture.configs }));
