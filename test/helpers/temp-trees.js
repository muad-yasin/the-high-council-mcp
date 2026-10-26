// Temp working folders of the tree tests (0.8.3 M5c, C&C's ruling 9 Oct: every test file M5c-M5g creates or touches removes its own folders; on 8 Oct the RAM-backed /tmp filled). Importing this file registers ONE
// `after` hook on the importing test file that removes every folder handed to `track`. Not a test file.
import { after } from 'node:test';
import { rmSync } from 'node:fs';
import { realRoot } from './real-root.js';

const made = new Set();
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export const track = dir => { made.add(dir); return dir; };
/** realRoot whose working folder is removed at the end of the file. */
export const trackedRealRoot = async opts => { const r = await realRoot(opts); track(r.t.work); return r; };
