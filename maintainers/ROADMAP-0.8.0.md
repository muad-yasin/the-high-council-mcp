# 0.8.0 roadmap (planning, not a build order)

*Written 2026-09-27 by C&C from four $0 research reports (an Opus 5.5 and a Fable 5.1 agent, each
checked by the other model as advisor; local `Review/Research_0.8.0_Debate_*_2026-09-27.md`, gitignored).
Owner: Muad. Items marked **owner** need his go (prompt changes, chain defaults).*

**Scope decided 2026-10-01 (Muad), after the wave-5 research and two reviews of it:**
- **0.8.0 is an engine release:** branch `wave-080` (UI request guard, WM0 engine additions, per-tool timing
  test, locked criteria, $0 criteria lints, `handoff --from-run`, criterion ids and disagreement records,
  resume refusing an unrecorded context change) merged with master. Its five open calls are accepted as
  built. Exit 14 for an edited `--context` is marked **Breaking** in the CHANGELOG.
- **The web UI (headline below, with replay) moves to 0.8.1**, not 0.9.
- **The council advisor add-on** (`council_quote` + `council_advise`, research in thc-research briefs 23-31)
  ships in **0.8.2**, on its own. Its patches need a rework step before they merge (five silent breaks on top of
  wave-080, and one naming pass so that `report.json` stays additive). Stop rule: exit 18 means "stopped before
  finishing" (by a person, a client cancel or a wall clock). It always writes a partial report and extends
  the existing `stoppedBy` (`user`, `wall_clock`, `client_cancel`). Whether a run resumes belongs to the chain;
  advice chains do not resume. The default single seat is GPT-6.1 Sol, **or GPT-6 Astra if a subscription route
  works** (research open). The default council is Sol + GLM-5.3 + Gemini 3.8 Flash, users may set their own
  chains, and there is a premium-7-style option.

## Headline: a local web interface for one council run (owner: "sounds great")

Local only (127.0.0.1), no third-party requests, keys never reach the browser, run folder and
`report.json` stay the truth. Start a run (task, chain, dry-run price, cap), answer questions, approve
criteria, watch the debate live, answer paused external seats, read/download plan, BOARD, HANDOFF.
Starts from `src/ui/` (today a read-only viewer). Order: ux-design pass (screens, states, wireframes)
→ owner review → build. Keep the line to Sophi-A/Zofia explicit (two repos, never merged).
Includes a **replay mode**: play any run back from `report.json` at 20-50x (proposal cards appear, objection
arrows land, withdrawals fade, the sign-off panel fills). It is the animation for the video below, built from real
data in the UI's own look, and every future run becomes demo footage. The design pass includes it as a screen.

**Design pass done 2026-09-28 (WM1.5, `Review/WebUI_Design_2026-09-28/`, local).** Six screens: Setup (with the spend
cap), Run, one "Your turn" gate panel, Live debate, Deliverables, Replay. The owner: *"very complex and hard to understand
for me, but I love it so far"*, so a requirement: the first-open path (SC0/SC1) must be understandable by the owner without
explanation. **owner, later:** an **"easy mode"** for less tech-savvy users (one step at a time, one button, "Look closer"
hidden); the $0 practice run is its seed. Open questions decided (owner-delegated to C&C + advisor, 2026-09-28):
1. Cap default = the dry run's worst case rounded up to the next $0.50. No $7 clamp (premium-7 dry-runs at $22.30, so a
   clamp would guarantee a run that dies mid-panel); above the CLI default the field asks for a typed confirmation, and it
   never proposes above `COUNCIL_MAX_USD_LIMIT` when set. Needs the dry run as JSON ([WM0]).
2. At the criteria stop: approve or stop only in 0.8; editing waits for item 10 (declared amendments). Assumes a criteria
   pause exists or lands in WM1 ([WM0] confirms).
3. No auto-open when DeepSeek Harness or Hermes starts a run: `start_run` returns the link (or the one command to start the
   UI) and returns fast (dsh's 60 s per-call cap).
4. Replay shows full text by default; recording mode (hides task, run text, paths) is a sticky setting with a visible badge
   when off. The video uses a demo task, never a private run.
5. First open: a $0 practice run as the main button; needs one combined mock chain that stops at every gate (WM1 work).

## Reach beyond Claude (owner, 2026-09-28: "Claude is what I use, not what most people use")

Researched 2026-09-28 (DeepSeek Harness dsh: web-UI-first, MCP via one `@deepseek-ai/dsh-mcp-client` plugin
entry per server, tools only, 60 s per-call cap; Hermes Agent: `~/.hermes/config.yaml` `mcp_servers`, 120 s
default tool timeout, first `npx -y` can hit the connect timeout, skills hub). Moved here from 0.7.9 by the owner:
- README install section first: one universal block (`npx -y the-high-council`, `OPENROUTER_API_KEY`), verified
  snippets for dsh and Hermes, then Cursor, VS Code, Codex, Gemini CLI, Windsurf, Cline, Zed and others;
  `npm i -g the-high-council` to avoid first-run timeouts, each agent's timeout key named.
- A "run a council from your agent" skill (start → poll `run_status` → answer writer seats via
  `external_prompt`/`submit_stage`; "no Claude subscription needed, your agent is the builder"), submitted to the
  Hermes skills hub and as a dsh plugin/skill if feasible.
- A test that every MCP tool answers well under 60 s. THC exposes tools only (no resources/prompts): keep it so.
- `npx the-high-council setup`: detect installed agents (dsh, Hermes, ...) and write their MCP config after asking.
- Web UI flows: `start_run` returns the UI link; the UI works when opened from another web tool (dsh users live
  in a browser: named test case); Hermes can relay the link and a "council done" message via its chat gateway.
- Third-party guides were part of the research; every snippet is verified against the tools' own docs first.

## Prerequisites (shipped as the small 0.7.9 bug-fix release, owner 2026-09-28)

Rollup H1 (fallback-model reply charged $0), M1 (empty `model` passes the router/No-Grok check),
M2 (`--rematch`/`--replay` skip lint), M3 (cut-off panel reply counts as sign-off), M4 (`stop:"error"`
draft passes), Fable R1 (bound re-paying an unchanged draft by re-asking only the unheard seat — a
bound on spend, not an early stop).

## Security (owner, 2026-09-28: "strong API-key-leak-protection ... quite important")

0.7.9 ships the first piece: a default-on scan of every outbound prompt for key shapes (`src/secret-patterns.js`) in
`invoke()`, hard stop with one explicit override. Candidates for 0.8, each needs the owner's go:
- **The return path.** What a run hands back to the calling agent (Claude Code, dsh, Hermes) is model text; a hostile
  seat could write instructions for that agent. Mark deliverable/board text as untrusted in MCP tool results and say so
  in every agent guide of "Reach beyond Claude".
- **owner** `security_review` on by default in the shipped plan chains (price shown first).
- Supply chain for the published package: lockfile pinned, `npm audit` in CI, `npm publish --provenance`, few deps.
- `SECURITY.md` + a short threat model: what the harness protects (keys, gitignored files, spend) and what it cannot
  (a password written in prose, a leak in a provider's own logs). No claims beyond what tests show.
- Web UI CSP (WM3): add `frame-ancestors 'none'` to the plan's `default-src 'self'`, so no other site can frame the UI and
  overlay clicks on the gate buttons (design pass finding).
- The NEEDS-file writer (external seats) through the same outbound scan, if 0.7.9 did not include it.
- The audit round's adversarial LOWs deferred from 0.7.9 (model-supplied reply keys, canary randomness on replay).

## Debate, criteria, milestones (both reports agree; advisor corrections folded in)

1. **Locked criteria** (Reddit idea): criteria hash in run.json/report.json (additive), harness-written
   lock block in HANDOFF.md, `council check-lock`/`verify-handoff` ($0). Fix first: `scope-freeze.js`
   `latestAmendmentTarget` matches 12-hex only; check the project's HANDOFF copy, not only the run's.
2. **$0 criteria lints** before paid rounds (consistency criterion, presence-only share, vague words).
3. **`council handoff --from-run`**: a HANDOFF even when a run stops early.
4. **Criterion ids + `missing_criteria[]` record** (additive); abstaining on missing rows behind a flag,
   off by default (real archives: 4 of 812 sign-offs short). Mock critics reply `criteria: []`, so mocks
   need updating. Land with R1.
5. **owner** Milestones with entry/exit checks + a final checklist in plan and HANDOFF (M0 walking
   skeleton; every locked criterion discharged by a milestone exit). Prompt change.
6. **owner** Two-way exchange: one debate rejoinder (concede/hold) and panel answer-back (critic sees
   the reviser's DECLINED reason; withdrawing needs a quote). Owner said "Not now" for answer-back;
   revisit here. No new rounds, no early stop.
7. **owner** "Kill / shrink / shelve" as a question to the human, never a veto.
8. **owner** Questions stage is off in every recommended chain (README lists it as stage 1): enable
   or reword the README. Enabling `blocking_questions` changes a prompt; note `ExternalPause` in runs.
9. Records of proposals the builder cut despite support; a per-round disagreement map.
10. Context changes during a pause need a declared amendment first, the same as a task change (owner 2026-09-28: 0.7.9 audit
    question 2, "later"). 0.7.9 already re-checks inputs on MCP resume (a secret added during a pause).

Excluded on the owner's rules: early stops, one-model-N-times modes, confidence-weighted votes,
xAI/Grok, any efficacy wording.

## Process

Scope the bundle with one `plan-daily-7` ("daily7") run: dry-run price first (≈ $1.90 worst case),
paid only on the owner's go; then build, docs, `npm publish` (his), GitHub release, .mcpb, Registry.

## Video (after 0.8; owner 2026-09-28: "create a YouTube video to explain the High Council ... get some more dev advice")

Shot only once the web UI and its replay mode exist; a terminal recording is the fallback.
- **Beats (~6-8 min):** the problem (one model plans alone, nobody contradicts it) → the idea (labs argue on the
  record, "together, and together with manners") → a real run in the replay (task, price before paying,
  proposals, debate, reviews, plan + HANDOFF; the `argued` report as the story spine) → "works with your agent"
  (DeepSeek Harness, Hermes, others; no Claude subscription needed) → one concrete question to devs.
- **Visuals already owned:** the /MCP page's round table with the robot characters, the round chart and the
  who-objected-to-whom graph (structure and counts only, no run text).
- **Showcase, one screenshot + one line each, public things only:** sower-industries.de, the GP scoreboard,
  Zofia and Sophi-A, SMO once on Play, and a short Fahrschule Drei drive-berlin teaser.
- **His voice:** script the beats, not the lines; he talks over the replay, one take, light cuts. His own words as
  cards. Honest bloopers are welcome (the car leaving the test pad at 250 km/h; the day the tests blocked his
  laptop and the night queue that followed).
- **Getting dev advice:** end on one answerable question ("which stage would you cut or add?"), a pinned GitHub
  Discussion linked first in the description, chapters. A 60-90 s vertical cut of the replay for short-form.
  German narration with English subtitles or two versions: his call.
- **Rules:** no efficacy claim anywhere (script, captions, thumbnail): "watch them argue" yes, "better plans" no.
  Costs shown are real and dated. No keys, private runs or personal-life details in frame (record on a clean
  profile, demo task or a run he wants public). No third-party footage, copyrighted music or brand logos; CC0 or
  his own music. Berlin data shown publicly carries the OSM/ODbL attribution in the description; check Unity's
  branding rules for game footage. Self-filmed Berlin b-roll: Panoramafreiheit from public ground, people and
  plates blurred.
- **Next:** C&C drafts the beat cards and prepares a demo run on his go, after 0.8 ships.

