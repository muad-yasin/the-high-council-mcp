// 0.8.3 (lane B): retired chains live in chains/outdated/ (not in the npm package, not searched by --chain). A test that reads a chain file as a FIXTURE
// (what the file says, how it lints) finds it in chains/ first, then in chains/outdated/. Nothing here makes a retired chain runnable by name.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const chainFilePath = (root, name) => [join(root, 'chains', `${name}.json`), join(root, 'chains', 'outdated', `${name}.json`)].find(existsSync) ?? join(root, 'chains', `${name}.json`);
export const readChainFile = (root, name) => JSON.parse(readFileSync(chainFilePath(root, name), 'utf8'));

// A retired chain copied into a project's own chains/ folder: exactly what the "no such chain" hint tells a person to do. The copy is a USER chain (not shipped), so use it only where the
// test already owns a temp work folder and its assertion does not depend on shipped status; advice chains are never read from a project's chains/ (src/send-profiles.js).
export function installOutdatedChain(root, workDir, name) {
  mkdirSync(join(workDir, 'chains'), { recursive: true });
  copyFileSync(join(root, 'chains', 'outdated', `${name}.json`), join(workDir, 'chains', `${name}.json`));
}

// Every chain file the package ships plus every retired one, as { file, path, dir }. The checks the ruling says "still scan the folder" (no Grok, reasoning never lowered, Kimi) read this list.
export const everyChainFile = root => ['chains', join('chains', 'outdated')].flatMap(d => readdirSync(join(root, d)).filter(f => f.endsWith('.json')).map(file => ({ file, dir: d, path: join(root, d, file) })));
