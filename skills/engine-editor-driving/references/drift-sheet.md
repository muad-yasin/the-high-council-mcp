# Drift sheet: how to keep one, and the Unity 6000.6 rows

## How to keep a drift sheet

A drift sheet lists habits an agent must not write from memory, because the engine moved. It earns its place only if it stays honest:

- **Every row has a primary link and a verified date.** A row with no date is not trusted. A date alone is not enough: say whether the page text was read raw or summarised, and keep a clause you did not re-read marked as such.
- **State what the docs say, not what you remember.** Several rows below corrected a first guess (a deprecation dated from the wrong version; a default that holds only for new projects).
- **Re-verify every row at each engine or package version change,** and when a compile warning about an obsolete call appears: that warning is the cue to look up the replacement, not to suppress it. A sheet written from a model's own recall is the failure the sheet exists to prevent.
- **One copy.** The scan list at the end lives in this file only; generate any scan from it rather than keeping a second list (`context-and-handoff`).
- **The replacement can move too.** Example: the 6000.0 page for `FindObjectOfType` says to use `FindFirstObjectByType` (or `FindAnyObjectByType` if any instance will do); the 6000.6 page says `FindAnyObjectByType`, and `FindFirstObjectByType` is itself deprecated.
- Where the editor has a reflection or docs tool, prefer it to the manual, and the manual for the exact version to memory.

## Unity 6000.6 (URP 17.6)

*Verified column: "re-read 2026-10-05" = raw page text fetched that day; "carried" = taken from an earlier read of 2026-10-04 and not re-read.*

| Old habit | What the documentation says | Source | Verified |
|---|---|---|---|
| Domain reload on entering play mode, so statics reset each play | 6000.6 manual: by default Unity does not reload the scripting domain on entering Play mode, and "Reload Scene only" is the default option. The 6000.3 page for the same setting says the domain is reloaded by default. The 6.6 What's New page says the new default applies **in new projects**; no page read says what an upgraded project gets. Read the project's own setting. Reset hooks: `[OnEnteringPlayMode]` / `[OnExitingPlayMode]` (manual) and `[AutoStaticsCleanup]` / `[NoAutoStaticsCleanup]` (generated, automatic). What's New also recommends keeping domain reload off in preparation for a future removal of Mono and the domain reload mechanism | docs.unity3d.com/6000.6/Documentation/Manual/configurable-enter-play-mode.html (and the same path under 6000.3); .../Manual/domain-reloading.html; .../Manual/WhatsNewUnity66.html | re-read 2026-10-05 |
| `GetInstanceID()` and other `int` object-id APIs | Since 6.4 the 64-bit `EntityId` replaces the 32-bit `InstanceID`; since 6.5 obsolete `InstanceID` APIs cause compilation errors. The page warns that code which bypasses the errors (suppressing them, or calling the int APIs from a precompiled assembly) can silently truncate identifiers at runtime, and that converting an `EntityId` through `int` silently truncates the high 32 bits. A package still using them can stop a project compiling | .../Manual/instanceid-to-entityid-migration.html | re-read 2026-10-05 |
| `Object.FindObjectOfType` | Marked obsolete; 6000.6 says use `FindAnyObjectByType`. Not new in 6.6: the 6000.0 page already marks it obsolete (pointing at `FindFirstObjectByType`) | .../ScriptReference/Object.FindObjectOfType.html (6000.6 and 6000.0) | re-read 2026-10-05 |
| `FindObjectsByType(type, FindObjectsSortMode)` and `FindFirstObjectByType` | The overloads taking a `FindObjectsSortMode` carry an Obsolete notice that points to the overloads without a sort mode and says the old sort order cannot be maintained once instance ids are replaced by entity ids; it appears on the 6000.4 and 6000.6 pages and not on the 6000.3 page, so the docs date it from **6000.4**, not 6.6. The no-sort overloads are the replacement and are not stale. `FindFirstObjectByType` is obsolete too, because it relies on instance-id ordering (its notice points to `FindAnyObjectByType`). Whether the attribute is a warning or an error in 6000.6 is not stated | .../ScriptReference/Object.FindObjectsByType.html (6000.3, 6000.4, 6000.6); .../Object.FindFirstObjectByType.html (6000.6) | re-read 2026-10-05; the `FindFirstObjectByType` date of 6000.4 is carried (a docs page can lag the code) |
| `Rigidbody.velocity` | `Rigidbody.linearVelocity` has a page in 6000.6; the 6000.6 `Rigidbody.velocity` page returns no API text. The rename itself dates from Unity 6.0 (carried, read on the 6000.0 pages by a helper) | .../ScriptReference/Rigidbody-linearVelocity.html | re-read 2026-10-05 (pages); the 6.0 date is carried, I |
| URP custom render passes written against `ScriptableRenderPass.Execute` / `SetupRenderPasses` | The 6.4 upgrade guide says URP Compatibility Mode is fully removed for custom render passes, that the `URP_COMPATIBILITY_MODE` scripting define is gone too, and to use the render graph system | docs.unity3d.com/6000.4/Documentation/Manual/UpgradeGuideUnity64.html | re-read 2026-10-05 |

### Also in the 6000.6 upgrade guide

Source for every row: docs.unity3d.com/6000.6/Documentation/Manual/UpgradeGuideUnity66.html, re-read 2026-10-05 as raw page text.

| Change | What it says | Why an agent session cares |
|---|---|---|
| `DEVELOPMENT_BUILD` and `UNITY_64` scripting symbols deprecated | Using either in `#if` or `[Conditional]` raises analyzer warnings (UAC0008 for `UNITY_64`, UAC0009 for `DEVELOPMENT_BUILD`). They still work in 6.6 and in 6.8 become a hard compilation error. If assemblies compile with warnings as errors, the warnings fail the build now. A per-platform Managed Code Variant setting controls diagnostic defines | Code that gates a development-only bridge or check on `DEVELOPMENT_BUILD` starts warning; agents write this symbol by reflex |
| Dynamic batching removed | The upgrade guide calls dynamic batching obsolete | Do not propose it as a draw-call fix; the guide points to other methods |
| Cinemachine 3 is a core package | Projects on Cinemachine 2 are upgraded automatically to a package with a different API and data format; staying on Cinemachine 2 means referencing a local copy in the manifest | Camera code written from memory of Cinemachine 2 breaks |
| YAML format change | The Reduce Version Control Noise option is removed and word wrapping is disabled in YAML text files; the guide notes most projects already had it disabled, and that you might see changes to YAML files that appear unrelated to your own; it suggests reserializing assets | A large unexpected diff after a bridge session is not necessarily the agent's doing; reserialize once, then diff |
| Rendering Debugger legacy state management removed | `DebugState`, `DebugState<T>`, legacy `DebugUIDrawer` and related types no longer compile | Old rendering-debug helper code from memory fails to compile |
| Performance testing package is now a core package | Projects that depend on it use the editor's version | Pin by editor version, not by package version |

**Forum-only planned breaks (grade I).** A UI Toolkit factory removal, the hierarchy API errors and a CoreCLR or domain-reload change are discussed by Unity staff in forum posts (2026-04-02 and June 2026) that disagree on versions; none is in the 6.6 upgrade guide. The one first-party signal is the 6.6 What's New sentence quoted in the first row: the removal of Mono and the domain reload mechanism is "forthcoming", with no version named. Re-check before every Unity upgrade; the 6.5 guide was read only for the `InstanceID` row.

## Banned-token scan (cheap, mechanical, runs in CI)

A grep over agent-written code for known-obsolete tokens catches drift that prose advice does not. Tokens for this sheet's rows (each added with its verified date; keep this the single copy):

`FindObjectOfType`, `FindFirstObjectByType`, `GetInstanceID`, `FindObjectsSortMode`, `DEVELOPMENT_BUILD` (a warning for now), `UNITY_64` (a warning for now), `DebugState` (verified 2026-10-05).

A scan is advisory: a hit means read the line. Add a token only with a source and a date, and enumerate the paraphrases first (a guard with a synonym hole gives confidence without coverage, `backend-developer`). Rows for other tools (a modelling package's API, say) keep their own list in their own sheet.
