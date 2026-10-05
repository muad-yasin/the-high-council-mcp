# The checker: what it checks, what it cannot see, and the evidence

`scripts/asset_check_core.py` holds every judgement as a pure function over plain lists; `scripts/blender_asset_check.py` loads the file into an empty Blender scene and extracts plain data. Verification so far, none of it in Blender: 24 unit tests (`python3 scripts/test_asset_check_core.py`) with one known-bad input per check, and a mutation pass (break one thing in the core, require the tests to fail) that caught 20 of 20 mutations. Run `scripts/run_checks.sh` on your Blender to exercise the glue; that is the first real test of it.

## The checks

| Check | How | Known-bad case | Cannot see |
|---|---|---|---|
| Size per world axis | Bounding box of all mesh objects in world space against `--expect-size X Y Z` | An upright box passes; the same box rotated 90 degrees fails; sorted mode (opt-in) passes it, which is why it is opt-in | Which way is forward within the plane, and parts misplaced inside the overall box: a pivot shift applied twice once put every wheel at the origin while all numbers stayed self-consistent (practitioner run). Landmark checks against a reference sheet catch that class; this checker does not |
| Triangles | Faces triangulated by count against `--max-tris` | A ceiling of 5 on a 12-triangle box | Budget fit: the ceiling comes from the target, not from Blender |
| Closed (solid profile) | After welding vertices within `--merge-dist`, edges used by one face or by 3+ faces | An open plane; exporter-split vertices pass only because of the weld | A mesh that is closed but wrong; use `--profile surface` for planes, decals, roads |
| Winding | Directed-edge counting: two neighbouring faces that traverse a shared edge in the same direction disagree about which side is out | One flipped face on a box (the single-number volume sign stays positive here, so a volume test alone passes it) | Consistently inverted shells (volume catches those) |
| Volume sign | Signed volume of the welded mesh in WORLD coordinates (solid profile, closed meshes only; otherwise a printed SKIP) | All faces inverted; a mirrored (negative-determinant) transform | Partial flips (winding catches those) |
| Mirror | Negative world determinant | A mirrored box | |
| Loose parts | Connected components per object (`--max-islands`) | Two boxes merged into one object | Parts that share a vertex but float conceptually |
| Floating objects | Connected components of "bounding boxes within `--touch-gap`" across objects | A box 1.5 m above another | A part sunk inside another's box, or a hair away on a tilted surface (boxes only) |
| Degenerate faces | Zero-area faces after welding | Three collinear points | |
| Scale | World scale from the world matrix (so parent chains and deltas count), on `.blend` and glTF; on FBX re-imports it is SKIPPED loudly and `--expect-size` becomes mandatory, because importer compensation makes transform scale non-evidence | A 0.01 world scale | The engine's own import transform |
| Modifiers | Count on `.blend` input; modifiers plus shape keys is always a FAIL | | Re-imported files have none: printed SKIP |
| UV, names, sidecar | UV layer present; no `.001` suffix; optional regex; optional JSON sidecar of triangle counts and sizes per object | Each has a unit test | UV quality, overlap |
| Empty / default scene | No mesh objects fails; a `.blend` containing only the default Cube, Light, Camera fails | Empty list; a mesh named Cube | |

`--fail-on-skip` turns any SKIP into a failing exit code. The FBX importer is chosen by feature test (`wm.fbx_import.get_rna_type()`; attribute lookup on `bpy.ops` never fails, so it is not a test) and falls back to the legacy importer with a printed WARN, never silently.

## Graded evidence for the claims in SKILL.md

| Claim | Grade | Source |
|---|---|---|
| Executable is easier than spatially correct; floating parts survive passing renders; execution feedback helps; VLM systems struggle with tasks easy for human Blender users | D | arXiv 2604.02580, 2606.01057, 2504.01786 abstracts, re-read 2026-10-05 |
| Single-prompt vision-model bug detection on 19,738 real QA keyframes: precision 0.50, accuracy 0.72; a second judge gave marginal gains (pointer for the visual-check owner) | D | arXiv 2603.22706 abstract, re-read 2026-10-05 |
| Operator poll fails where an API call would raise; the return value reports finished or cancelled; `Context.temp_override` with `logging_set` | D | Blender 5.1 API "Gotchas: Using Operators" and `Context`, read 2026-10-05 |
| Exporter signatures, defaults, `apply_scale_options` modes, bake warning, modifier and shape-key warning, custom-props defaults | D | Blender 5.1 API `export_scene`, read 2026-10-05 |
| `wm.fbx_import` exists with no axis options; the legacy FBX import is deprecated | D | Blender 5.1 API `wm`, `import_scene` and manual FBX page, read 2026-10-05 |
| Blender 5.0 removed an API family and renamed an engine identifier (the items live in the dated drift list, not here) | D | Blender 5.0 Python API release notes, read 2026-10-04 |
| Which `apply_scale_options` value gives a clean scale-1 transform in an engine; why a legacy re-import once showed 0.01 | I (unresolved) | needs the cross in probe 4 and an engine import |
| Undo is unreliable across bridge operations | practitioner observation | no primary source found |
| Cycles on CPU renders with no GL context; EEVEE and Workbench needed a GL library or virtual display on a bare server | practitioner runs (5.0.1 and 5.1.2) | unpublished |

## Observations from an earlier probe script (Blender 5.0.1, superseded, not re-run)

Operator with no active object raised a poll `RuntimeError`; `BLENDER_EEVEE_NEXT` raised `TypeError`; `action.fcurves` was gone; a closed box exported to glTF and re-imported reported 24 non-manifold edges raw and 0 after welding; a Workbench render worked with software GL once the EGL runtime library was installed (before that the process aborted with exit code 134: noted, not recorded). The current probe re-asks all of these and more on whatever version you run.

## Not verified

Everything in Blender 5.1 at run time (scripts, glue, preset); what any FBX variant becomes in a particular engine; when `use_mesh_modifiers` started excluding Armature modifiers; whether binary FBX files can be searched for skin and bind-pose markers (a rig check, out of this skill's scope).
