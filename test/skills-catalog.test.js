// test/skills-catalog.test.js
//
// skills/README.md (the catalog) and docs/skills.html (the customer-facing presentation) both list
// the skills shipped in skills/. Nothing derives those lists - they are typed by hand - so, like
// docs/index.html's headline numbers (test/landing-page.test.js), they go stale silently while
// still looking authoritative. This derives the real set from skills/ and fails when either
// document lists a skill that doesn't exist or misses one that does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

test('every skill folder has a SKILL.md whose frontmatter name matches the folder and carries a description', () => {
  assert.ok(skills.length > 0, 'expected at least one skill folder');
  for (const name of skills) {
    const path = join(skillsDir, name, 'SKILL.md');
    assert.ok(existsSync(path), `skills/${name} has no SKILL.md`);
    const text = readFileSync(path, 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `skills/${name}/SKILL.md has no frontmatter block`);
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'), `skills/${name}/SKILL.md frontmatter name does not match its folder`);
    assert.match(fm[1], /^description: .{80,}$/m, `skills/${name}/SKILL.md needs a real description (what it does and when to use it)`);
  }
});

test('every references/ file a SKILL.md points to exists', () => {
  for (const name of skills) {
    const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
    for (const m of text.matchAll(/`references\/([A-Za-z0-9._-]+\.md)`/g)) {
      assert.ok(existsSync(join(skillsDir, name, 'references', m[1])), `skills/${name}/SKILL.md points at references/${m[1]}, which does not exist`);
    }
  }
});

test('skills/README.md catalogs exactly the skills that exist', () => {
  const catalog = readFileSync(join(skillsDir, 'README.md'), 'utf8');
  const listed = [...new Set([...catalog.matchAll(/\]\(([a-z0-9-]+)\/SKILL\.md\)/g)].map(m => m[1]))].sort();
  assert.deepEqual(listed, skills, 'skills/README.md must link every skill folder exactly once-per-name, and nothing else');
});

const pagePath = join(root, 'docs', 'skills.html');
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : null;

test('docs/skills.html presents exactly the skills that exist', { skip: !page && 'no docs/skills.html' }, () => {
  const presented = [...page.matchAll(/data-skill="([a-z0-9-]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(presented, skills, 'docs/skills.html must have one data-skill card per skill folder, and no others');
});

test('docs/skills.html is script-free and makes no third-party requests', { skip: !page && 'no docs/skills.html' }, () => {
  assert.doesNotMatch(page, /<script\b/i, 'the skills page must carry no scripts');
  // Anything the browser fetches: src=, href= on link tags, CSS url(). An <a href> to an external
  // site is navigation, not a request, so plain anchors are allowed.
  for (const m of page.matchAll(/\bsrc=["']([^"']+)["']/gi)) assert.doesNotMatch(m[1], /^(https?:)?\/\//i, `third-party src: ${m[1]}`);
  for (const m of page.matchAll(/<link\b[^>]*href=["']([^"']+)["']/gi)) assert.doesNotMatch(m[1], /^(https?:)?\/\//i, `third-party link: ${m[1]}`);
  for (const m of page.matchAll(/url\(([^)]+)\)/gi)) assert.doesNotMatch(m[1], /^['"]?(https?:)?\/\//i, `third-party url(): ${m[1]}`);
  for (const m of page.matchAll(/url\((fonts\/[^)]+)\)/g)) assert.ok(existsSync(join(root, 'docs', m[1])), `self-hosted font missing: docs/${m[1]}`);
});

test('the catalog and the page both keep the no-efficacy-claim statement', { skip: !page && 'no docs/skills.html' }, () => {
  const catalog = readFileSync(join(skillsDir, 'README.md'), 'utf8');
  assert.match(catalog, /No efficacy claim/i);
  assert.match(page, /No efficacy claim/i);
});
