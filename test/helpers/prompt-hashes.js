// The prompts a mock chain sends, as hashes, per stage (0.8.3 M3). `chainModule` is the URL of a src/chain.js: the repo's own, or an export of an older commit (how test/fixtures/prompt-hashes-6ee1946.json was made:
// `git archive 6ee1946` into a scratch folder, this function run on that folder's src/chain.js). A prompt is a stage's cache key (promptHash), so "byte-identical to 6ee1946" is "an old run still resumes". Not a test file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const GOLDEN_CHAINS = ['mock', 'mock-debate', 'mock-unanimous', 'mock-dispute', 'mock-relay'];

/** { chain: [ 'label system-sha user-sha', ... ] } sorted: stages that run in parallel arrive in any order. `repoRoot` holds chains/ and src/ of the same commit. */
export async function promptHashes({ repoRoot, chains = GOLDEN_CHAINS, extra = {} }) {
  const { runChain, setPromptSpy } = await import(new URL(`file://${join(repoRoot, 'src', 'chain.js')}`).href);
  const out = {};
  for (const name of chains) {
    const config = JSON.parse(readFileSync(join(repoRoot, 'chains', `${name}.json`), 'utf8'));
    const seen = [];
    setPromptSpy(p => seen.push(`${p.label} ${sha(p.system)} ${sha(p.user)}`));
    try { await runChain({ request: 'Plan a small reading list app with login and a shared shelf.', config, runId: 'r-prompts', log: () => {}, ...extra }); } finally { setPromptSpy(null); }
    out[name] = seen.sort();
  }
  return out;
}
