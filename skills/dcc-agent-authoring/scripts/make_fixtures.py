"""Builds the known-good and known-bad .glb files that run_checks.sh feeds to the checker (needs Blender / a bpy wheel).
NOT run yet. Usage: python make_fixtures.py <outdir>      or    blender -b --python make_fixtures.py -- <outdir>
Each bad file is one defect of one kind, so a check that stays green on it is a check that cannot fail."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asset_check_core as core  # noqa: E402
import export_preset as ep  # noqa: E402


def build(bpy, name, verts, faces, matrix_rot_x_deg=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (matrix_rot_x_deg * 3.141592653589793 / 180.0, 0, 0)
    return ob


def main(argv=None):
    import bpy
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = argv[0] if argv else "fixtures"
    os.makedirs(out, exist_ok=True)
    print("blender", bpy.app.version_string)

    def scene(fn):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        return fn()
    dims, ctr = (2.0, 4.5, 1.4), (0, 0, 0.7)       # X width, Y length, Z height; sits on z = 0
    v, f = core.box_mesh(dims, ctr)
    cases = {}
    cases["good"] = lambda: [build(bpy, "Body", v, f)]
    cases["lying"] = lambda: [build(bpy, "Body", *core.box_mesh(dims, (0, 0, 0)), matrix_rot_x_deg=90.0)]   # same box on its side
    cases["open"] = lambda: [build(bpy, "Body", [(0, 0, 0), (2, 0, 0), (2, 4, 0), (0, 4, 0)], [(0, 1, 2, 3)])]  # a plane, not a solid
    cases["flipped_face"] = lambda: [build(bpy, "Body", v, [tuple(reversed(f[0]))] + f[1:])]
    cases["inverted"] = lambda: [build(bpy, "Body", v, [tuple(reversed(x)) for x in f])]
    def floating():
        a = build(bpy, "Body", v, f)
        v2, f2 = core.box_mesh((1, 1, 1), (0, 0, 4.0))
        return [a, build(bpy, "Wing", v2, f2)]
    cases["floating"] = floating
    for key, fn in cases.items():
        objs = scene(fn)
        ep.export_gltf(os.path.join(out, f"{key}.glb"), objs, apply_modifiers=False)
        if key in ("good", "lying"):
            # the FBX path: preset function, decisions spelled out (an example choice, not a recommendation: see references/export-pair.md)
            ep.export_fbx(os.path.join(out, f"{key}.fbx"), objs, apply_scale_options="FBX_SCALE_UNITS",
                          bake_space_transform=False, apply_modifiers=False)
    with open(os.path.join(out, "corrupt.glb"), "w") as fh:
        fh.write("x\n")
    print("fixtures written to", out, sorted(os.listdir(out)))


if __name__ == "__main__":
    main()
