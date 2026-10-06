# The export pair: exporter flags plus engine import settings

Read before writing or changing an export function. Wording marked (5.1) is quoted from the Blender 5.1 API reference or manual, read 2026-10-05. Nothing here has been run in Blender by the authors; `scripts/blender_probe.py` probe 4 and an engine import are what settle the open choices.

## The decisions, made once per engine and recorded beside the function

| Decision | Options | What the documentation says | How it is settled |
|---|---|---|---|
| Which side converts axes | Exporter (`axis_forward`, `axis_up`, `use_space_transform`) or the engine's importer (for example a "bake axis conversion" style option) | Manual (5.1): many applications use a different up axis, so set Forward/Up for the target; `bake_space_transform` exists to avoid unwanted rotations when the target space is not aligned with Blender's | One engine import with the axes set one way; record the engine-side setting. Never convert on both sides |
| Where the unit factor lives | `apply_scale_options`: `FBX_SCALE_NONE` (default), `FBX_SCALE_UNITS`, `FBX_SCALE_CUSTOM`, `FBX_SCALE_ALL` | (5.1) NONE applies custom and unit scaling to each object transformation and leaves the FBX scale at 1.0; UNITS applies custom scaling to each object transformation and unit scaling to the FBX scale; the option text adds that Blender reads the FBX scale to detect units on import and many other applications do not | Probe 4 for the Blender side (size is right either way); an engine import for the engine side. The honest status of any claim that one value "fixes the 0.01 scale" is unresolved until the cross is run |
| Bake the space transform | `bake_space_transform` False (default) or True | (5.1) bakes the space transform into object data; the manual marks it experimental, at your own risk, and known to be broken with armatures and animations | Static meshes: prove by engine import, or leave False. With an armature: do not use; the example function raises |
| Modifiers | `use_mesh_modifiers` (FBX) / `export_apply` (glTF) | (5.1) applies modifiers to mesh objects except armatures; the manual warns it prevents exporting shape keys | Apply in the script and export with application off; or accept the exporter doing it and no shape keys |
| Custom data | `use_custom_props` (FBX, default False), `export_extras` (glTF, default False) | (5.1) defaults are off | Sidecar file read by the engine side and compared by the checker |
| Formats | FBX, glTF/GLB | glTF export is headless-capable (a probe on 5.0.1 and a project run on 5.1.2 both exported it) | One format per pipeline stage, each proven once in the engine |

## Flags the example writes out on purpose (even when equal to the default)

`global_scale=1.0`, `apply_unit_scale=True`, `apply_scale_options` (required), `use_space_transform=True`, `bake_space_transform` (required), `object_types` (default MESH and EMPTY; ARMATURE only with the armature rules), `use_mesh_modifiers` (required), `mesh_smooth_type='FACE'`, `use_custom_props=False`, `add_leaf_bones=False`, `path_mode='COPY'`, `embed_textures=False`. For glTF: `export_format='GLB'`, `export_yup=True`, `export_apply` (required), `export_extras=False`, `export_materials='EXPORT'`, `export_cameras=False`. Every keyword was matched against the 5.1 reference by `check_api_names.py` (a name check only: it proves the keyword exists, not what it does). `export_format` is typed as a plain string in the 5.1 reference; `'GLB'` was accepted in earlier runs (5.0.1 probe, a 5.1.2 project run).

## Reading probe 4 (apply_scale_options x bake_space_transform x importer)

It exports the same 2.0 x 4.5 x 1.4 m box eight ways (two scale options, bake off and on, each re-imported with the new importer `wm.fbx_import` and the legacy `import_scene.fbx`) and prints, per case, the world size and world scale. The question each answers:

- Is the world size 2.0 x 4.5 x 1.4 in every case? It must be; a case that differs is a real defect.
- In which cases is the world scale 1 and in which 0.01 (or 100)? The pattern, not one cell, tells you whether the flag, the importer, or the bake causes the compensation. A single earlier observation (scale 0.01 after a re-import with the legacy importer, bake on, `FBX_SCALE_NONE`) changed two variables at once, which is why this cross exists.
- The new importer has no axis options of its own in the 5.1 reference; the legacy one is documented as deprecated (the 5.1 manual points to the official FBX importer instead). Prefer the new importer for checks and say which one a result used.

What a Blender re-import shows is not what an engine will show. Engine-side settings are recorded next to the exporter flags once one import has passed; until then the report says "provisional".

## Manual gaps

The 5.1 manual's FBX page still has bare headings for "Apply Scaling" and "Apply Unit" and a leftover `todo` marker on the legacy import axis options; "Apply Transform" carries the experimental warning. The API reference documents `apply_scale_options` fully. Treat the API reference and the exporter source as the primary sources for each flag, and pin the tested recipe.
