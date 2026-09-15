import test from "node:test"; import assert from "node:assert/strict"; import { isOk } from './target.js'; test('isOk', async () => { assert.equal(await isOk(7), true); });
