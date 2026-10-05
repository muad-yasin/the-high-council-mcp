"""Numeric asset check for agent-built meshes: loads a file in Blender, extracts plain data, and hands it to
asset_check_core.py, which holds every judgement. One line per check, FAIL/SKIP/PASS/INFO, exit 1 on any FAIL.

STATUS: written against the Blender 5.1 API reference. This file (the Blender-facing glue) has NOT been run in
Blender; the checks themselves are exercised without Blender by test_asset_check_core.py. Run
`run_checks.sh` once on your installed Blender before trusting it, and keep that output with the asset.

Usage (inside Blender, or with a `bpy` wheel whose version equals your Blender binary):
  blender -b --factory-startup --python blender_asset_check.py -- <file.glb|.gltf|.fbx|.blend> [options]
  python blender_asset_check.py <file> [options]
Options:
  --profile solid|surface   solid (default): closed, outward, positive volume. surface: open meshes allowed (planes, decals, roads)
  --max-tris N              triangle ceiling per object
  --expect-size X Y Z       whole-scene size in WORLD axes (Blender: X right, Y forward, Z up), metres; compared per axis
  --size-sorted             compare sorted extents instead (blind to a rotated asset: only when the frame is unknown)
  --tol 0.05                relative size tolerance
  --touch-gap D             every object must lie within D metres (bounding boxes) of another: finds floating parts
  --max-islands N           loose parts allowed per object
  --check-scale             FAIL when world scale is not 1 (.blend and glTF). FBX: skipped loudly, --expect-size required
  --require-uv  --allow-modifiers  --allow-negative-scale  --allow-dup-suffix  --name-regex RE
  --sidecar file.json       {"objects": {"<name>": {"tris": n, "size_m": [x, y, z], "tol": 0.02}}}
  --fbx-importer auto|new|legacy   auto = wm.fbx_import when it exists, otherwise legacy with a WARN line
  --fail-on-skip            exit 1 when any check was SKIPPED
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asset_check_core as core  # noqa: E402


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("path")
    ap.add_argument("--profile", choices=["solid", "surface"], default="solid")
    ap.add_argument("--max-tris", type=int, default=0)
    ap.add_argument("--max-islands", type=int, default=0)
    ap.add_argument("--expect-size", type=float, nargs=3)
    ap.add_argument("--size-sorted", action="store_true")
    ap.add_argument("--tol", type=float, default=0.05)
    ap.add_argument("--touch-gap", type=float, default=0.0)
    ap.add_argument("--merge-dist", type=float, default=1e-5)
    ap.add_argument("--check-scale", action="store_true")
    ap.add_argument("--require-uv", action="store_true")
    ap.add_argument("--allow-modifiers", action="store_true")
    ap.add_argument("--allow-negative-scale", action="store_true")
    ap.add_argument("--allow-dup-suffix", action="store_true")
    ap.add_argument("--name-regex")
    ap.add_argument("--sidecar")
    ap.add_argument("--fbx-importer", choices=["auto", "new", "legacy"], default="auto")
    ap.add_argument("--fail-on-skip", action="store_true")
    return ap.parse_args(argv)


def load_file(bpy, path, fbx_importer):
    """Import into an EMPTY scene. Every operator result is checked: a CANCELLED import must not read as an empty-but-fine scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        res = bpy.ops.import_scene.gltf(filepath=path)
        kind = "gltf"
    elif ext == ".fbx":
        kind = "fbx"
        use_new = fbx_importer in ("auto", "new")
        if use_new:
            try:
                bpy.ops.wm.fbx_import.get_rna_type()  # attribute lookup on bpy.ops never fails; this does
            except Exception:
                if fbx_importer == "new":
                    sys.exit("FAIL wm.fbx_import is not available in this Blender; use --fbx-importer legacy")
                print("WARN wm.fbx_import not found: using the legacy import_scene.fbx. Object transforms and scale differ from the "
                      "new importer; the world-size check is the evidence")
                use_new = False
        res = bpy.ops.wm.fbx_import(filepath=path) if use_new else bpy.ops.import_scene.fbx(filepath=path)
        print(f"importer: {'wm.fbx_import' if use_new else 'import_scene.fbx (legacy)'}")
    elif ext == ".blend":
        res = bpy.ops.wm.open_mainfile(filepath=path)
        kind = "blend"
    else:
        sys.exit(f"FAIL unsupported file type {ext}")
    if res != {"FINISHED"}:
        sys.exit(f"FAIL import returned {res}, not FINISHED")
    return kind


def extract_objects(bpy):
    """Plain data per mesh object: world matrix, evaluated vertex tuples and face index tuples. Nothing Blender-typed leaves here."""
    bpy.context.view_layer.update()  # matrix_world can be stale right after an import operator
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        try:
            verts = [tuple(v.co) for v in me.vertices]
            faces = [tuple(p.vertices) for p in me.polygons]
        finally:
            ev.to_mesh_clear()
        out.append(dict(name=o.name, verts=verts, faces=faces,
                        matrix_world=[list(r) for r in o.matrix_world],
                        modifiers=len(o.modifiers), shape_keys=o.data.shape_keys is not None,
                        uv_layers=len(o.data.uv_layers), materials=len(o.material_slots)))
    return out


def main(argv=None):
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    a = parse_args(argv)
    import bpy  # imported here so asset_check_core and the tests never need Blender
    print("blender", bpy.app.version_string)
    kind = load_file(bpy, a.path, a.fbx_importer)
    objs = extract_objects(bpy)
    opts = core.Options(profile=a.profile, max_tris=a.max_tris, max_islands=a.max_islands, merge_dist=a.merge_dist,
                        expect_size=tuple(a.expect_size) if a.expect_size else None, size_tol=a.tol, size_sorted=a.size_sorted,
                        touch_gap=a.touch_gap, check_scale=a.check_scale,
                        scale_mode="skip_fbx" if kind == "fbx" else "check",
                        require_uv=a.require_uv, allow_modifiers=a.allow_modifiers,
                        allow_negative_scale=a.allow_negative_scale, allow_dup_suffix=a.allow_dup_suffix,
                        name_regex=a.name_regex, source_kind=kind,
                        sidecar=json.load(open(a.sidecar)) if a.sidecar else None)
    rows, infos = core.check_scene(objs, opts)
    for i in infos:
        print(f"object {i['name']}: tris={i['tris']} size_m=({i['size'][0]:.3f},{i['size'][1]:.3f},{i['size'][2]:.3f}) materials={i['materials']}")
    for r in rows:
        print(core.format_row(r))
    counts, failed = core.summarize(rows, a.fail_on_skip)
    print(f"summary: {counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped, {counts['INFO']} info"
          f" (file {a.path}, source {kind})")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
