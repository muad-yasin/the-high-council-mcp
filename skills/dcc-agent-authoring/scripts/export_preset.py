"""One export function per target, every geometry/axis/scale flag written out, every result checked.

STATUS: written against the Blender 5.1 API reference (docs.blender.org/api/5.1/bpy.ops.export_scene.html, read
2026-10-05); NOT run in Blender. The values below are an ANNOTATED EXAMPLE for a Y-up, -Z-forward target, not "the"
preset: the decisions marked DECIDE must be made once per engine, proven by one import into that engine, and recorded
next to this function. They are keyword-only and have no default on purpose, so a call cannot leave them implicit.

Usage inside Blender (objects = a list of bpy objects in the current view layer):
    import export_preset as ep
    ep.export_fbx("/out/car.fbx", objects, apply_scale_options="FBX_SCALE_UNITS", bake_space_transform=False, apply_modifiers=False)
    ep.export_gltf("/out/car.glb", objects, apply_modifiers=False)
"""
import os
import time


def _select(bpy, objects):
    """Select exactly `objects` through the data API (no ambient context needed). If an operator still fails its poll,
    wrap the call in `with bpy.context.temp_override(...)` and call logging_set(True) on the override to see which
    context members it reads (Blender API: Context.temp_override)."""
    view_layer = bpy.context.view_layer
    for o in view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    view_layer.objects.active = objects[0]


def _verify(result, path, t0, what):
    """An operator reports failure through its return set, not an exception (Blender API gotchas, 'Using Operators')."""
    if result != {"FINISHED"}:
        raise RuntimeError(f"{what} returned {result}, not FINISHED")
    if not os.path.exists(path) or os.path.getsize(path) == 0 or os.path.getmtime(path) < t0 - 2:
        raise RuntimeError(f"{what}: {path} is missing, empty or older than this call")


def export_fbx(path, objects, *, apply_scale_options, bake_space_transform, apply_modifiers,
               axis_forward="-Z", axis_up="Y", object_types=("MESH", "EMPTY"), use_custom_props=False):
    """FBX export. Keyword-only DECIDE arguments (no default):
      apply_scale_options  'FBX_SCALE_NONE' puts the unit factor into the object data, 'FBX_SCALE_UNITS' puts it into the
                           file header (Blender 5.1 API wording: 'Apply custom scaling to each object transformation, and
                           units scaling to FBX scale'). Both give the right size in metres; which one gives a clean
                           scale-1 transform in YOUR engine is decided by an engine import, not by Blender.
      bake_space_transform the API calls it 'experimental ... known to be broken with armatures/animations'. Refused here
                           when an armature is exported; for static meshes prove it by an engine import or leave it False
                           and let the engine's own axis-conversion setting do the work. One side converts, never both.
      apply_modifiers      'Apply modifiers to mesh objects (except Armature ones) - WARNING: prevents exporting shape keys'.
                           Prefer False and apply modifiers yourself in the build script.
    use_custom_props defaults to False (the API default): custom properties do NOT travel. Put game data in a sidecar file."""
    import bpy
    object_types = set(object_types)
    if "ARMATURE" in object_types and bake_space_transform:
        raise ValueError("bake_space_transform with ARMATURE: Blender documents it as known to be broken with armatures/animations")
    if any(o.type == "ARMATURE" for o in objects) and "ARMATURE" not in object_types:
        raise ValueError("an armature is in the export set but object_types excludes ARMATURE: the skin would be dropped silently")
    _select(bpy, objects)
    t0 = time.time()
    res = bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True,
        axis_forward=axis_forward, axis_up=axis_up,
        global_scale=1.0, apply_unit_scale=True, apply_scale_options=apply_scale_options,
        use_space_transform=True, bake_space_transform=bake_space_transform,
        object_types=object_types, use_mesh_modifiers=apply_modifiers,
        mesh_smooth_type="FACE", use_custom_props=use_custom_props, add_leaf_bones=False,
        path_mode="COPY", embed_textures=False)
    _verify(res, path, t0, "export_scene.fbx")
    return path


def export_gltf(path, objects, *, apply_modifiers, export_extras=False):
    """glTF binary export. export_yup=True is the glTF convention (Y up); export_extras=False is the API default, so
    custom properties do NOT travel unless you switch it on; a sidecar file is the safer carrier."""
    import bpy
    _select(bpy, objects)
    t0 = time.time()
    res = bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True,
        export_apply=apply_modifiers, export_extras=export_extras,
        export_materials="EXPORT", export_cameras=False)
    _verify(res, path, t0, "export_scene.gltf")
    return path
