# 202: the MCP install command names no version, so npx may start a release that is not the newest

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

**The command.** The command that adds THC to an MCP client names the package without a version. It appears in these forms:
- `npx -y the-high-council council --mcp`:
  - `README.md:33`, under "Try it in 30 seconds";
  - `AI-README.md:74` and `:683`;
  - `docs/mcp-clients.md:8`, and as a comment at `:120`;
  - the landing page, `docs/index.html:484`. That page is served nowhere; the live install page belongs to the project's website, outside this repository, and was not read.
- `npx -- -y the-high-council council --mcp`, in a client's own command (`docs/mcp-clients.md:67`).
- The split form a client config uses: `"args": ["-y", "the-high-council", "council", "--mcp"]` (`docs/mcp-clients.md:77` and `:101`).
- A comment in the server: `src/mcp/server.js:8`.

The CLI's own hints use the unpinned form when the CLI was started through npx (`councilCommand`, `src/invocation.js:11`). They are printed in a paused stage's prompt and in the pause log (the resume lines, `src/cli.js:4762` and `:4780`), and in the tree commands. The README's other command lines use it too: demo, init, doctor, a dry run, a run, a resume and a tree. So does the landing page's doctor line (`docs/index.html:451`).

**Reported, not verified.** Both reports were observed once, on 14 Nov 2026, with npm 10.9.9. How other npm versions behave is not known, and why npx behaves this way was not checked.
- npx started an older release from its own cache while a newer one was the latest on npm. Naming the version (`the-high-council@<version>`) started the newer one.
- Run inside a clone of this repository, the command fails ("council: command not found"). The package's `bin` is `council` (`package.json`).

**What does not use the unpinned command:**
- The registry entry names its version (`server.json`), and `test/distribution-manifests.test.js:28-32` keeps it equal to `package.json`'s.
- The `.mcpb` bundle (`mcpb/manifest.json`) and the Claude Code plugin (`.claude-plugin/plugin.json`) start the server with `node`.
- A clone has its own forms: `node src/cli.js` (`AI-README.md:361`) and the absolute-path MCP command (`AI-README.md:692`; `docs/mcp-clients.md:150-158`). `README.md` names neither.

**Not part of this item, and unverified:** whether the plugin route starts. `AI-README.md:698-712` says Claude Code runs `npm ci` in its plugin cache. `test/claude-plugin.test.js:1-10` says it does so only when the root has a lockfile. No install was run.

## The smallest change

Write the version form that question 1 picks into every install form above, in one commit: `the-high-council@latest`, or a fixed version, in the string forms and in the split form's `args`.
- If question 2 says so, the same form also goes into the other command lines and into `councilCommand` (`src/invocation.js:11`).
- If question 3 says so, `README.md` gains one line that points a clone to `node src/cli.js` and to the absolute-path MCP command.

## The test, and how it fails first

- **NP-1.** Every install form names `@latest` or a version: every `npx` line that runs `the-high-council` with `--mcp` in `README.md`, `AI-README.md`, `docs/mcp-clients.md` and `docs/index.html`, and every `args` list there that holds `"the-high-council"`. For a fixed version, it equals `package.json`'s, the way `test/distribution-manifests.test.js:28` keeps `server.json` equal.
  - Expected red today (not run): `README.md:33` names neither, and neither does any other form listed above.
  - It matches by prefix (`the-high-council@`), in the string forms and in `args`.
  - It reads command lines and `args` lists only. The prose at `docs/mcp-clients.md:153` names the form, but it is not a command, and the server's comment (`src/mcp/server.js:8`) changes with the lines but is not tested.
- **The scanner of the docs' command lines** (`test/cli-unknown-flag.test.js:159-175`). Its pattern (`:168`) takes a line that begins with `npx <one word> council`, `council`, `node src/cli.js` or `npm run`.
  - It reads fenced code blocks only (`:163-166`), so the indented lines of `README.md` (`:29`, `:33`) are not read at all.
  - The install lines in fenced blocks do not match it either: they begin with the client's command, or with `npx -y`. They are not scanned, before or after the change.
  - A line such as `npx the-high-council@latest council demo` still matches.
- **If `councilCommand` changes** (question 2), these become changed accepted tests (`git grep -n -E "npx( -y)? the-high-council" -- test/`):
  - `test/first-ten-minutes.test.js:23-32` (the hint, and the demo's next commands, init and doctor);
  - the two tests of `test/tree-member-texts.test.js` that run under npx and see `councilCommand`'s real output: `:84` (over MCP) and `:108` (at the CLI). The test at `:66-72` passes its own spelling and stays green.
- `test/landing-page.test.js` checks the page's counts and that it is script-free, not its commands.

These run with the change:
- NP-1;
- `test/first-ten-minutes.test.js`, `test/tree-member-texts.test.js`, `test/cli-unknown-flag.test.js`, `test/distribution-manifests.test.js` and `test/landing-page.test.js`;
- the source scanners.

## The owner's gates

- **Prompt wording:** none.
- **Sentences a person or a session reads:** the install forms. Under question 2, also the other command lines and the CLI's hints; under question 3, the README's clone line. All are A-DRAFT until the owner's yes.
- **Money:** none.
- **Hand-typed counts:** a fixed version is a hand-typed figure that moves with every release. NP-1 compares it with `package.json`, so a release that leaves a line behind turns NP-1 red.

## What the change must not touch

- `server.json`, `mcpb/manifest.json` and `.claude-plugin/plugin.json`: they do not use npx.
- The `github:` source forms (`AI-README.md:362` and `:686`). They run the current source on purpose.
- The package's name and its `bin`.

## Questions only the owner can answer

1. Which form do the install lines take?
   - (a) `@latest`. Result: npx is asked for the newest release at each start. That is npm's behaviour, not checked here, and it needs an answer from npm at each start.
   - (b) A fixed version, such as `@0.8.5`. Result: the line runs exactly that release, and it moves with every release.
   - (c) No change. Result: today's behaviour, under which a person may start an older cached release (reported once).
2. Do the other command lines, and the CLI's own hints, take the same form?
   - (a) No. Result: only the install lines change. The resume command printed in a paused stage's prompt and in the pause log keeps the unpinned form.
   - (b) Yes. Result: every printed command names the version, so a paused run is resumed by the release that the hint names. The sites are the lines with `npx the-high-council` that are not install forms: 7 in `README.md`, 12 in `AI-README.md`, 2 in `TROUBLESHOOTING.md` and 1 in `docs/index.html`, besides `councilCommand`. NP-1 reads install forms only, so a check must read these too, or the two sets can drift apart. Under question 1(a), the hint holds `@latest`, so that is the newest; under 1(b), `councilCommand` must read the package's own version (`package.json`).
     - What happens when a run is resumed by a release other than the one that paused it was not read.
3. Does the README gain a line for a person working in a clone of the repository?
   - (a) Yes. Result: the README points such a person to `node src/cli.js` and to the absolute-path MCP command, as `AI-README.md` already does.
   - (b) No. Result: the clone forms stay in `AI-README.md` and `docs/mcp-clients.md` only.
