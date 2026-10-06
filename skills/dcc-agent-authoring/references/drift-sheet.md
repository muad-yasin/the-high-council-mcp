# Blender API drift sheet (5.x, with the 4.x changes that still bite)

*One dated drift list per Blender/engine pair lives here; do not copy it into scripts or prompts. Each row is what a release note says, with the page it comes from. Rows were read on the dates in the last column; none of them was exercised against Blender 5.1 in this repository (see "Owed" below).*

| Old habit | What the release notes say | Source | Read |
|---|---|---|---|
| Render engine `'BLENDER_EEVEE_NEXT'` | 4.2 renamed the identifier to `BLENDER_EEVEE_NEXT`; 5.0 renamed it back to `BLENDER_EEVEE`, and the 5.1 API default is `'BLENDER_EEVEE'`. Assigning the old id raised a `TypeError` in a probe on 5.0.1 | developer.blender.org/docs/release_notes/5.0/python_api/ | 2026-10-01 (5.0.1 probe) |
| `action.fcurves`, `action.groups`, `id_root` | The legacy Action API was removed in 5.0 (slotted actions). The 5.1 API `Action` page lists no `fcurves` or `groups`. Slotted actions may still expose F-curve collections on a channel group; that is an inference to check on 5.1, so do not ban `.fcurves` on its own | 5.0 python_api notes; the 5.1 API reference | 2026-10-01 |
| `scene.use_nodes`, `scene.node_tree` | `use_nodes` is deprecated ("will be removed in 6"); `node_tree` was removed in 5.0 | 5.0 python_api notes | 2026-10-01 |
| Dict-style access to `bpy.props` properties (`scene['cycles']`) | the 5.0 notes say they can no longer be reached directly through dict-like Python syntax | 5.0 python_api notes | 2026-10-01 |
| `bgl` module | the deprecated BGL API is removed: use the `gpu` module | 5.0 python_api notes | 2026-10-01 |
| Principled BSDF sockets `Subsurface`, `Specular`, `Transmission`, `Coat`, `Sheen`, `Emission` | Renamed in 4.0: `Subsurface Weight`, `Specular IOR Level`, `Transmission Weight`, `Coat Weight`, `Sheen Weight`, `Emission Color` | 4.0 python_api notes | page re-read 2026-10-05 |
| The `bpy.ops` context override argument | the context override argument to `bpy.ops` is removed in favour of `context.temp_override(..)` | 4.0 python_api notes | page re-read 2026-10-05 |
| `mesh.use_auto_smooth`, `auto_smooth_angle` | Removed in 4.1 | 4.1 python_api notes | 2026-10-01 (not re-read since) |
| The Python version in the interpreter | Blender 5.1 moves to Python 3.13. A probe on 5.0.1 ran Python 3.11; a re-run on 5.1.2 printed 3.13.9 | 5.1 python_api notes | 2026-10-01 |

**Banned-token scan (Blender half).** Flag these in any script before it runs: `BLENDER_EEVEE_NEXT`, `use_auto_smooth`, `scene.node_tree`, `action.fcurves`. Keep this list and the table above in step; the engine side has its own list in `engine-editor-driving`.

**Owed.** A 5.1.2 re-run of the probe (`scripts/blender_probe.py`) to confirm each row on the build in use; a merge of any 5.1-specific changes the probe finds. Until then, treat a row as "the release notes say", not "verified here".
