---
name: engine-editor-driving
description: Operates a game-engine editor through an agent bridge (a Unity editor driven over an MCP server, or any scripted editor) without trusting success replies, readiness flags or a filtered console - reading every write back through a second channel, treating a timed-out call as possibly landed, never carrying object ids across a reload, keeping play-mode edits out of the asset, one session per editor, the code-execution tool as a trust boundary, and the editor as a heavy job that needs the owner's go. Use whenever a task creates, edits or bakes scenes, prefabs, materials, assets, import settings or editor scripts through an editor bridge, runs editor menu tools or tests, or when an editor result looks fine but the game disagrees. Not for the bridge's own tool schemas and recipes (the vendor's operator docs), for making the assets, for running the built game, or for designing proof that a change works (verification-and-critique).
license: MIT
---

# Engine Editor Driving

An editor is a long-lived, stateful program with its own idea of what is compiled, saved, selected and playing. A bridge lets an agent call into it, and every call can succeed while doing nothing, or doing the old thing. The agent's worst habit here is believing the reply. The editor's state, and the files it wrote, are the truth.

**Evidence.** The editor-operation rules come from one shipped Unity project and from one first-hand trial of one bridge (two bridge versions, one Linux machine, Unity 6000.6); both are practitioner evidence, graded I. The bridge facts come from that bridge's own source, release notes and docs at a named tag, and from Unity's manual: documented, read on the dates in `references/unity.md`, not our experience. Where a rule is an inference the sentence says so. Other editors are unverified (last section).

**This skill owns:** how to act on an editor safely and how to know the action landed. **It hands off:** tool names and call recipes (the bridge vendor's operator docs); the stale-build run, output-artifact checks, serialized defaults and registries kept in data (`backend-developer`); destructive-action lists, retries and spend (`tool-and-action-discipline`); what counts as proof and per-item summaries (`verification-and-critique`); shared workspaces and long-run notes (`context-and-handoff`). Making the assets, game code rules and running the built game are other skills' work.

## 0. The editor is a heavy job; the owner's rules come first

An editor, its import workers and a test run are a multi-gigabyte job. Start one only with the owner's go where the project requires it, inside the project's resource limits and lock, one at a time, and never while the owner is using the machine or the editor. These rules outrank everything below. Inside them, do the editor step through the bridge instead of handing it back to the owner, and say "done" only when the read-back below says so. Check the editor vendor's terms of service for automated access yourself or ask the owner; this skill cannot settle that.

## 1. A success reply proves nothing: read it back through a second channel

- **The reply is the weakest evidence.** Documented examples in one widely used bridge: a menu-item call answers success once the item is invoked, whatever the item then does; an asset-modify call answers success when no property matched; a play call can report that play started while the editor cancelled it (`references/unity.md`).
- **A second channel is anything other than the call that wrote:** an executed read of the live value, the saved file on disk (reading scene and prefab files as text is fine, and is how you verify), the importer's stored setting, the editor's log file.
- **Compile state first.** A menu tool, bake or batch method run while compile errors exist, or a recompile is unfinished, executes the last good assembly and reports success. Before it: a fresh compile with zero errors. After it: check the artifact, not the log - a value only the new code writes (`backend-developer`, the stale-build run). After a script edit the call's return is not the finish line: prove the compile on disk (a freshly written assembly, the reload line in the editor log), not by a flag.
- **Worked case.** A bridge says "prefab rebuilt, success"; the console holds one compile error; the saved prefab lacks the new field. The rebuild is **not done**. Cite the compile error first, read the saved prefab for a value only the new code writes, and do not re-run the tool until the compile is clean.
- **Read the console after every mesh, material, prefab, import or script call**, and treat a new warning as a finding until explained. An empty console is evidence only after a known test line you just logged shows up in it (a nonce): a console tool can hide entries behind the window's own filters. If the nonce is missing, read the log file instead, and know which one: the per-project log by default, a global log when the editor was started to use one. "No console errors" says nothing threw, not that the thing is visible or correct.
- **Save explicitly.** Nothing documents an automatic scene save. A scripted edit to an asset is not written unless the asset is marked dirty and saved; until then the live value and the file can differ, and without it the value reverts when the editor reopens.

## 2. Readiness flags are advisory; prove liveness and completion by effect

A bridge's "ready", "compiling" or "reload pending" flag can be stale. In one measured run the ready flag read stale while the editor was focused and idle, on two bridge versions, and the code cause was still there at the latest tag read. **Never block on a ready flag.** Liveness is a trivial executed call that returns. Completion is a side effect you can read: the fresh assembly, the reload marker in the log, the written file. The bridge's own docs tell you to read the flag first; the measurement says to treat it as a hint.

An unfocused editor can also stop ticking: documented failure signs are play mode sitting at frame 1 while status says "playing", a screenshot that is a stale frame, state reads that never change. Wait on a frame counter you have seen advance before trusting a capture or a play-mode result. The editor's Interaction Mode preference governs idling between editor frames, but the manual says Play mode ignores it, so it is not the lever for a stuck play session (`references/unity.md`).

## 3. A timed-out call may have landed

On one bridge a timed-out command keeps running, its result is dropped, the caller is told it failed, and nothing marks a retry as a retry. So after a timeout, **check whether the effect landed before re-issuing**: a re-issued create duplicates objects. This is the editor form of "retry a write only with an idempotency key" (`tool-and-action-discipline`): the bridge has no key, so the check is the key. A timeout with an empty error during a long call is a probable modal dialog (section 5), not a failure to retry.

## 4. Object ids die at a reload

An object id the bridge hands out is scoped to one editor session. In the measured run it failed loudly after every domain reload (any compile), and a fresh find handed out a working id again. Never carry an id across a compile, a reload or a session. Resolve again by a stable name or path: list first, then act on the listed set.

## 5. Modal dialogs stop an unattended editor

A scene-reload prompt, a save prompt or the Safe Mode prompt blocks every call and shows up only as timeouts. Save scenes before long or batch work, keep the active scene clean, and when calls time out with no error suspect a dialog. If the bridge cannot connect after a compile error, the editor may be in Safe Mode, where no project or package code runs, the bridge included. Fix the C# files directly (they are plain text), confirm the bridge reconnects, and expect the manual's behavior: Safe Mode exits by itself once the errors are gone.

## 6. Play mode

- **Never make a persistent edit in play mode.** Scene edits made while playing are discarded when play stops. A ScriptableObject is different: the manual says you can save to one in edit or play mode, and that a scripted change is not written to disk unless the asset is marked dirty. In the shipped project a play-mode tweak survived play stop (practitioner report, I), so the live value and the file can disagree until something dirties and saves the asset, and the tweak then lands on the next save. Make accepted values as deliberate edit-mode changes, save, and re-verify from a fresh play session. Worked case: a data asset was tuned in play mode. Read **both** the live value (an executed read) and the file; a mismatch is a pending write, not "no change". Revert the live value on purpose, save, and read the file again.
- **A live-iteration capture can lie by persistence.** A prop nudged in play mode looked right in later captures because a separate anchor made in edit mode still lined up. Redo the accepted value in edit mode and capture again.
- **Do not edit scripts while playing** and expect live state to survive: a recompile in play mode can reload the scripting domain. The editor setting that defers it ("Recompile After Finished Playing") is the safe choice; the 6000.6 default continues playing after the recompile.
- **Check the project's own Enter Play Mode setting** before relying on whether statics reset between plays: Unity 6.6 changed the default for new projects (`references/unity.md`).

## 7. One owner per editor, one bridge

Pin which editor instance a session talks to before its first mutating call. A shared editor shares compile state, the scene and play state, so calls land in the wrong project, and one session's compile errors poison another's runs. Exactly one session owns an editor at a time; the other plans or edits only files the owner is not touching (`context-and-handoff`). Pin the bridge itself by tag or commit and re-read its release notes at each bump: a pin recorded on one day was superseded by a new release three days later, and the fix the project needed was in the new one. Do not install two bridges at once: conflicts between them are documented.

## 8. Escape hatches, spend and telemetry

- **The code-execution and menu-item tools are the trust boundary.** The bridge's own docs call its safety checks "not a full sandbox". Keep one-off scripts short, put them in a throw-away folder, and remove them as the last step, saying so in the report (forgotten editor scripts have overwritten hand edits; one practitioner report). Where the project forbids deletion, move them aside as that rule says.
- **Group gating is a convenience, not a boundary.** "Tool not found" can mean a group is switched off, but a batch call can reach a disabled tool by name. Tools that spend money (asset generation through paid model APIs) need the owner's go per use, whatever the gating.
- **Write scenes, prefabs and meta files through the editor.** Hand-edited YAML can produce files the editor reads as empty, and hand-made meta files break references (practitioner reports, I). Reading them as text is fine.
- **Telemetry:** bridges often send usage telemetry by default, and the opt-out may need setting in both the server and the editor process. Do not change the bridge's configuration yourself; ask the owner.

## 9. Long and batched work, and rollback

- **Time-bound every call.** A synchronous call gets a fixed budget (30 s over HTTP in one widely used bridge). Import, bake, test runs and builds run as async jobs you poll through a state file, a job id or the log, and the plan records which step you were on (`context-and-handoff`).
- **Version control is the rollback.** Undo covers some bridge tools and not others: a source grep of one bridge found no undo registration in its asset, build, script, shader and texture tools. Commit before a batch and read the diff after; save before anything destructive.
- **Prefer the running editor's reflection, then the manual for the exact version, over memory** when you write an API call: models recall an older era's API and the replacements move. A dated, linked drift sheet is `references/drift-sheet.md`.

## 10. Owned elsewhere (one line each)

- Fresh build before a long tool, output artifact over log: `backend-developer` (verification traps).
- Changed defaults never reach serialized assets; content added to a scene or data list must be checked in the saved file: `backend-developer`.
- The script is the artifact, session state is lost; destructive work against an enumerated, confirmed list: `backend-developer`, `tool-and-action-discipline`.
- One summary line per object in a batch: `verification-and-critique`.

## Other editors: not verified

Nothing here was confirmed against an Unreal or Godot project. Questions to answer the first time, and record what you watched: what is the equivalent of "a tool runs the last compiled code" (live coding, hot reload), what survives a play-in-editor session, how the bridge reports completion, and whether it reports readiness truthfully.

## Mistakes to flag

- A success reply accepted with no read-back through a second channel.
- A menu tool, bake or batch run on a broken or unfinished compile, then trusted from its log.
- Blocking on a ready flag instead of proving liveness and completion by effect.
- A timed-out mutating call re-issued without checking whether it landed.
- An empty console trusted without a nonce; a console tool's silence read as "no errors".
- An object id reused after a compile, reload or session change.
- A play-mode edit left in place; a tuning tweak to an asset made while playing.
- A scripted asset edit never marked dirty or saved.
- Mutating calls to an editor instance nobody confirmed; two sessions driving one editor.
- A long call held open past the bridge's timeout instead of polled as a job.
- An escape-hatch script left in the project; a paid tool reached through a batch call.
- An editor launched, a test run started or a bake run without the owner's go where the project requires one.

Depth: `references/unity.md` (Unity editor facts and one bridge at a named tag, with dates and grades), `references/drift-sheet.md` (how to keep a drift sheet, and the dated Unity rows).
