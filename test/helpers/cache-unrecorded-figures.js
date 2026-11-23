// The dry run's figures in the UNRECORDED state of the cache-shaped order (0.8.4 cache part (b)1): the order's words are not installed, so the marks of ruling B and their rows are what is priced. ONE function, used by the capture
// probe (run on the parent f039a88a through the box, its output pinned as test/fixtures/cache-unrecorded-f039a88a.json) and by test/cache-unrecorded-pin.test.js (run on the tree under test): the pin fails when the tree under test
// prices anything in that state differently from the parent. Every lifetime is explicit (the default flipped to 5m in this unit and is outside the pin). Uses nothing the parent lacks.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateChainRows } from '../../src/cost.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { lintPromptCache } from '../../src/prompt-cache.js';
import * as HB from '../held-prompts/held-084-b.js';
import { DEMAND } from './rating-demand.js';

const sonnet = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
const synthetic = (overseer, switchOn) => ({ name: 'dry', signoff: 'unanimous', ...(overseer ? { maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 } } : { maxRounds: 2 }), estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 }, ...(switchOn ? { prompt_cache: { enabled: true, ttl: switchOn } } : {}),
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [sonnet('a', 1), sonnet('b', 1), sonnet('c', 2), sonnet('d', 3)] } });
const W26 = { lateFindingRule: HB.lateFindingRule, lastRoundReplyRule: HB.lastRoundReplyRule };
const PAIR = { shortExchangeRule: HB.shortExchangeRule, signoffLineRule: HB.signoffLineRule };

/** { synthetic: { '<variant>|<ttl or off>|<figure>': [rows] }, shipped: { '<chain>|<ttl>|<figure>': { usd, input, output, rows } } } */
export function unrecordedFigures(root, configs = null) {   // configs: { '<file>': parsed chain } (the pin hands it the parent's own chain files, so a later change of chains/ is not drift in the cost code); null reads root/chains
  const out = { synthetic: {}, shipped: {} };
  const variants = { overseer: [true, null], passes: [false, null], 'overseer-held': [true, { ...DEMAND, ...W26, ...PAIR }] };
  for (const [name, [overseer, held]] of Object.entries(variants)) for (const ttl of ['off', '5m', '1h']) for (const maximum of [false, true]) {
    setHeldForTest(held);
    out.synthetic[`${name}|${ttl}|${maximum ? 'maximum' : 'expected'}`] = estimateChainRows(synthetic(overseer, ttl === 'off' ? null : ttl), { maximum });
  }
  setHeldForTest(null);
  const chains = configs ?? Object.fromEntries(readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'))]));
  for (const [f, base] of Object.entries(chains)) {
    if (base.advise?.enabled === true) continue;
    for (const ttl of ['off', '5m', '1h']) {
      const config = ttl === 'off' ? base : { ...base, prompt_cache: { enabled: true, ttl } };
      if (ttl !== 'off' && lintPromptCache(config, f).length) continue;
      for (const maximum of [false, true]) {
        const rows = estimateChainRows(config, { maximum });
        out.shipped[`${f}|${ttl}|${maximum ? 'maximum' : 'expected'}`] = { usd: rows.reduce((t, r) => t + r.usd, 0), input: rows.reduce((t, r) => t + r.input, 0), output: rows.reduce((t, r) => t + r.output, 0), rows: rows.length };
      }
    }
  }
  return out;
}
