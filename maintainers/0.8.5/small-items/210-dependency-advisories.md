# 210: the lockfile holds dependency versions with published advisories

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. No npm command was run to prepare this note. The audit below was run once on the same lockfile, on 23 Nov 2026 with npm 11.20.0 (`npm audit --package-lock-only`), and its output was read.

## What is wrong

**The audit** names 10 packages, which npm counts as "10 vulnerabilities": 1 critical, 4 high and 5 moderate. Under them stand 38 advisory lines, which are 37 distinct advisories (`body-parser` repeats one for its second copy). Every one of the ten packages is marked "fix available via `npm audit fix`".

| Package | Locked | Range flagged | Severity | Reached through (lockfile) |
| --- | --- | --- | --- | --- |
| `proxy-addr` | 2.0.7 | 1.1.0 - 2.0.7 | critical | `express` 4.22.2 (wants `~2.0.7`) and the SDK's own `express` 5.2.1 (`^2.0.7`) |
| `@modelcontextprotocol/sdk` | 1.30.0 | <= 1.31.0 | high | a direct dependency (`^1.30.0`) |
| `zod` | 4.6.4 | < 4.6.6 | high | a direct dependency (`^4.6.4`); also a peer of the SDK |
| `body-parser` | 1.20.8 and 2.3.0 | < 1.20.9, and >= 2.0.0 < 2.4.0 | high | `express` 4.22.2 (`~1.20.5`) and the SDK's `express` 5.2.1 (`^2.2.1`) |
| `undici` | 7.29.1 | 7.0.0 - 7.30.0 | high | `@yao-pkg/pkg-fetch` (`^7.28.0`), under the devDependency `@yao-pkg/pkg` |
| `hono` | 4.13.7 | <= 4.13.15 | moderate | the SDK (`^4.11.4`) |
| `@hono/node-server` | 2.1.1 | 1.19.10 - 2.1.5 | moderate | the SDK (`^1.19.9 \|\| ^2.0.5`) |
| `fast-uri` | 3.1.7 | 3.0.0 - 3.1.8 | moderate | `ajv` 8.20.0 (`^3.0.1`), which the SDK requires |
| `ip-address` | 10.7.0 | <= 10.7.3 | moderate | `express-rate-limit` 8.7.0 (`^10.2.0`), which the SDK requires |
| `qs` | 6.15.3 and 6.16.0 | 2.2.5 - 6.16.0 | moderate | the two copies of `express` and of `body-parser` (`~6.15.1`, `^6.14.0`, `^6.15.2`, `~6.16.0`) |

The versions, the ranges and the requiring packages come from `package-lock.json` (lockfile version 3).
- **What `package.json` lists:**
  - two dependencies, `@modelcontextprotocol/sdk ^1.30.0` and `zod ^4.6.4`;
  - three devDependencies, `@yao-pkg/pkg 6.22.0`, `ajv ^8.20.0` and `express ^4.22.2`.
- **What the lockfile marks as development-only:** `undici` alone of the ten. It marks `express` 4.22.2 as production, although `package.json` lists it as a devDependency; why was not read.

**What the code imports:**
- the SDK at `src/mcp/server.js:10-11` (`McpServer` and `StdioServerTransport`: the server runs on stdio);
- `zod` at `src/mcp/server.js:12`, `src/mcp/contract.js:11` and `src/mcp/start-ladder.js:7`;
- `express` only in `src/http-server.js:22`, which the npm package leaves out (`package.json` `files`; pinned by `test/package.test.js:44-55`).
- No file in `src/` imports any other package in the table. Whether the SDK's stdio path loads its HTTP stack at runtime (`express`, `body-parser`, `proxy-addr`, `hono`) was not checked.

**Which installs get which versions:**
- **npm:** `package-lock.json` is not in the npm package, so `npx` or `npm install` of the package resolves both ranges, and the SDK's own tree, fresh at install time. For such an install, the floors in `package.json` are what count.
- **The plugin:** the Claude Code plugin installs from the repository. Claude Code runs `npm ci --ignore-scripts` in its plugin cache when the root has a lockfile (`test/claude-plugin.test.js:7-9`; not run here), so a plugin install gets the locked versions.
- **The binaries:** they are built after `npm ci` (`.github/workflows/release-binaries.yml:23`), from the locked versions. The workflow runs only when started by hand, and since 0.8.4 a release carries no binaries (the workflow's own header).
- **The `.mcpb` bundle** installs the production dependencies of the npm tarball at build time (`scripts/build-mcpb.sh:25`, `npm install --omit=dev`, no lockfile), and keeps whatever resolved then. Which versions the released bundle holds was not checked.

## The smallest change

The change has two parts, one per route.
1. **The floors, for npm installs.** In `package.json`, raise the SDK to its first patched version after 1.31.0, and `zod` to `^4.6.6`. Each advisory's page names its patched version; confirm both there.
2. **The lockfile, for the plugin and the binaries.** A builder refreshes `package-lock.json` with npm on a test machine. The requiring ranges above say which locked versions can move within range; whether they do is for npm to show, not this note.
3. **The measure:** the audit, run again on the refreshed lockfile. Its output goes into the build's report. Each line that remains is either fixed by its own bump (for example `express` within `^4`, or `@yao-pkg/pkg`) or recorded (question 2).
4. **The dated note** of question 1:
   - each advisory, read from its page against the imports above;
   - and, to settle the HTTP-stack question, a runtime check of which SDK modules the stdio server loads.
5. **The full suite,** on a test machine. A change in the SDK or in `zod` can move tool schemas and answers that tests pin. For example, `test/cap-wording.test.js:20-21` reads a property's description "wherever the schema converter put it".

## The tests, and the exit check

- **No new suite test.** A test that restates the floors of `package.json` could not fail for the reason that matters. The check that can fail is the audit, and it needs the registry, so it is an exit check of the build, with its output.
- These tests read the dependencies, and run with the change (`git grep -n -E "package-lock|modelcontextprotocol|devDependencies" -- test/`):
  - `test/claude-plugin.test.js:48-51`: every dependency is in the lockfile;
  - `test/binary-packaging.test.js:32`: `@yao-pkg/pkg` is an exact version;
  - `test/package.test.js:50`: `express` stays a devDependency;
  - `test/session-reads-sdk-strip.test.js:8-10`: it imports the SDK's server, client and in-memory transport.
- **The `max_usd` path.** `zod` validates `max_usd` on `start_run` and `resume_run` (`MAX_USD_ARG`, `src/mcp/server.js:184`). The tests of that path run with the bump: `test/cli-usd-limit.test.js`, `test/max-usd-zero.test.js`, `test/mcp-max-usd-per-run.test.js`, `test/mcp-usd-limit-env.test.js`, `test/mcp-usd-limit-paths.test.js`, `test/mcp-usd-limit-start.test.js` and `test/mcp-usd-limit.test.js`.
- **The full suite,** on a test machine, is the guard for the rest.

## The owner's gates

- **Prompt wording:** none.
- **Sentences a person or a session reads:** the dated note and the 0.8.5 change note, A-DRAFT until the owner's yes.
- **Money:** no price, count or reservation changes. But `zod` checks the spending limit a session passes over MCP (`src/mcp/server.js:184`), so the `max_usd` tests above are part of the set.
- **Hand-typed counts:** none. No document lists the dependency versions (`git grep -n -i dependenc -- README.md AI-README.md docs/ CONTRIBUTING.md`).

## What the change must not touch

- No new major version: SDK 2 or `zod` 5 would be another change.
- Code in `src/`, unless the bump makes a change necessary there. Any such change is named in the build's report.
- The package's `files` list, and the lockfile's format.

## Not part of this item, and unverified

`package.json` `pkg.scripts` is `src/**/*.js`, which takes in `src/http-server.js`. Nothing in `src/cli.js` starts the HTTP server (no reference to it), so a binary cannot run it. Whether `pkg` still bundles `express` and its tree into the binaries because of that file was not checked.

## Questions only the owner can answer

1. Where does the dated note live?
   - (a) `KNOWN-LIMITS.md`. Result: it ships with the package, and `test/known-limits.test.js` reads it.
   - (b) A new `SECURITY.md` at the root. Result: a new file; `package.json` `files` decides whether it ships.
   - (c) Only the 0.8.5 change note. Result: no standing note.
2. The saved audit ends "To address all issues, run: npm audit fix", so npm expects nothing to remain after a fix, `undici` included. This question applies only if a line remains after the refresh:
   - (a) Accepted, each named in the note. Result: the audit still prints them.
   - (b) Gone. Result: each one needs its own change: a bump outside the range, a replacement, or a removal.
