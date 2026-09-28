# 0.8.0 roadmap (planning, not a build order)

*Written 2026-09-27 by C&C from four $0 research reports (an Opus 5.5 and a Fable 5.1 agent, each
checked by the other model as advisor; local `Review/Research_0.8.0_Debate_*_2026-09-27.md`, gitignored).
Owner: Muad. Items marked **owner** need his go (prompt changes, chain defaults).*

## Headline: a local web interface for one council run (owner: "sounds great")

Local only (127.0.0.1), no third-party requests, keys never reach the browser, run folder and
`report.json` stay the truth. Start a run (task, chain, dry-run price, cap), answer questions, approve
criteria, watch the debate live, answer paused external seats, read/download plan, BOARD, HANDOFF.
Starts from `src/ui/` (today a read-only viewer). Order: ux-design pass (screens, states, wireframes)
→ owner review → build. Keep the line to Sophi-A/Zofia explicit (two repos, never merged).

## Reach beyond Claude (owner, 2026-09-29: "Claude is what I use, not what most people use")

Researched 2026-09-29 (DeepSeek Harness dsh: web-UI-first, MCP via one `@deepseek-ai/dsh-mcp-client` plugin
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

## Prerequisites (shipped as the small 0.7.9 bug-fix release, owner 2026-09-29)

Rollup H1 (fallback-model reply charged $0), M1 (empty `model` passes the router/No-Grok check),
M2 (`--rematch`/`--replay` skip lint), M3 (cut-off panel reply counts as sign-off), M4 (`stop:"error"`
draft passes), Fable R1 (bound re-paying an unchanged draft by re-asking only the unheard seat — a
bound on spend, not an early stop).

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

Excluded on the owner's rules: early stops, one-model-N-times modes, confidence-weighted votes,
xAI/Grok, any efficacy wording.

## Process

Scope the bundle with one `plan-daily-7` ("daily7") run: dry-run price first (≈ $1.90 worst case),
paid only on the owner's go; then build, docs, `npm publish` (his), GitHub release, .mcpb, Registry.
