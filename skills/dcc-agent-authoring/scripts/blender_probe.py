"""Probe: records what THIS Blender does for the claims the skill makes. It asserts nothing about expected values:
a line starting OBSERVED means 'ran without raising'; compare the values with the skill by eye, then keep the output.
It is the first known-good script for the version it ran on (see 'Pin the version' in SKILL.md).

STATUS: rewritten from a probe that ran on Blender 5.0.1; this version has NOT been run. The earlier 5.0.1 observations
(an operator with no context raises RuntimeError; BLENDER_EEVEE_NEXT raises TypeError; action.fcurves is gone) were from
the old script and are not re-asserted here. Run: python blender_probe.py [outdir]   (bpy wheel whose version equals your
Blender binary), or: blender -b --python blender_probe.py -- [outdir]. Set EXPECT_BPY=5.1 to abort when the version differs.
Order matters: the Workbench render is LAST because a missing GL library aborts the whole process (no exception to catch).
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asset_check_core as core  # noqa: E402
import blender_asset_check as bac  # noqa: E402
import export_preset as ep  # noqa: E402
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
out = argv[0] if argv else tempfile.mkdtemp()
os.makedirs(out, exist_ok=True)
print("blender", bpy.app.version_string, "python", sys.version.split()[0])
want = os.environ.get("EXPECT_BPY")
if want and not bpy.app.version_string.startswith(want):
    sys.exit(f"ERROR bpy {bpy.app.version_string} does not match EXPECT_BPY={want}: the wheel must equal the Blender binary that will run the scripts")


def probe(name):
    def deco(fn):
        try:
            print(f"OBSERVED {name}: {fn()}")
        except Exception as e:  # a probe that raises is itself an observation
            print(f"ERROR {name}: {type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}")
    return deco


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make(name, dims=(2.0, 4.5, 1.4), center=(0, 0, 0.7)):
    v, f = core.box_mesh(dims, center)
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


@probe("1 an operator with no active object")
def _():
    reset()
    try:
        bpy.ops.object.vertex_group_add()
    except RuntimeError as e:
        return "RuntimeError: " + str(e).strip().splitlines()[-1][:140]
    return "no error raised"


@probe("2 mesh built from data needs no operator context; scene units")
def _():
    reset()
    ob = make("Box")
    s = bpy.context.scene.unit_settings
    return f"verts={len(ob.data.vertices)} dims={tuple(round(x, 3) for x in ob.dimensions)} unit_system={s.system} scale_length={s.scale_length}"


@probe("3 an export that cannot write: does it raise or return a set?")
def _():
    reset()
    ob = make("Box")
    try:
        r = ep.export_gltf(os.path.join(out, "no_such_dir", "x.glb"), [ob], apply_modifiers=False)
        return f"export_gltf returned {r!r} (the helper checks the return set and the file)"
    except Exception as e:
        return f"helper raised {type(e).__name__}: {str(e).splitlines()[0][:160]}"


def world_report(tag):
    objs = bac.extract_objects(bpy)
    parts = []
    for o in objs:
        wv = core.to_world(o["verts"], o["matrix_world"])
        size = core.bbox_size(*core.bbox(wv))
        parts.append(f"{o['name']}: world_size={tuple(round(x, 3) for x in size)} world_scale={tuple(round(x, 4) for x in core.mat_scale(o['matrix_world']))}")
    return f"{tag} -> " + "; ".join(parts)


def importer_new(path):
    return bpy.ops.wm.fbx_import(filepath=path)


def importer_legacy(path):
    return bpy.ops.import_scene.fbx(filepath=path)


@probe("4 FBX 2x2x2: apply_scale_options x bake_space_transform x importer (box 2.0 wide, 4.5 long, 1.4 tall, Z up)")
def _():
    lines = []
    for opt in ("FBX_SCALE_NONE", "FBX_SCALE_UNITS"):
        for bake in (False, True):
            reset()
            ob = make("Box")
            path = os.path.join(out, f"box_{opt}_{int(bake)}.fbx")
            ep.export_fbx(path, [ob], apply_scale_options=opt, bake_space_transform=bake, apply_modifiers=False)
            for label, fn in (("wm.fbx_import", importer_new), ("import_scene.fbx(legacy)", importer_legacy)):
                reset()
                try:
                    res = fn(path)
                    lines.append(f"\n    {opt} bake={bake} {label}: {world_report(str(res))}")
                except Exception as e:
                    lines.append(f"\n    {opt} bake={bake} {label}: ERROR {type(e).__name__}: {str(e).splitlines()[0][:100]}")
    return "".join(lines)


@probe("5 glTF binary export, then import: world size")
def _():
    reset()
    ob = make("Box")
    path = os.path.join(out, "box.glb")
    ep.export_gltf(path, [ob], apply_modifiers=False)
    reset()
    bpy.ops.import_scene.gltf(filepath=path)
    return f"{os.path.getsize(path)} bytes; " + world_report("glb re-import")


@probe("6 old EEVEE identifier BLENDER_EEVEE_NEXT (drift sheet item, kept as a quick version fingerprint)")
def _():
    reset()
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError as e:
        return "TypeError: " + str(e)[:160]
    return "accepted"


@probe("7 legacy action.fcurves (drift sheet item)")
def _():
    reset()
    return "has fcurves attr: %s" % hasattr(bpy.data.actions.new("a"), "fcurves")


@probe("8 mesh numbers through the pure checks: triangles, open edges, volume")
def _():
    reset()
    make("Box")
    o = bac.extract_objects(bpy)[0]
    wv, wf = core.weld(core.to_world(o["verts"], o["matrix_world"]), o["faces"], 1e-5)
    er = core.edge_report(wf)
    return f"tris={core.tri_count(o['faces'])} open={er['open']} inconsistent={er['inconsistent']} volume={core.signed_volume(wv, wf):.3f}"


@probe("9 glTF round trip: open edges before and after welding (exporters split vertices)")
def _():
    reset()
    ob = make("Box")
    path = os.path.join(out, "box_rt.glb")
    ep.export_gltf(path, [ob], apply_modifiers=False)
    reset()
    bpy.ops.import_scene.gltf(filepath=path)
    o = bac.extract_objects(bpy)[0]
    wv = core.to_world(o["verts"], o["matrix_world"])
    raw = core.edge_report(o["faces"])["open"]
    wv2, wf2 = core.weld(wv, o["faces"], 1e-5)
    return f"open edges raw={raw} after_weld={core.edge_report(wf2)['open']} verts raw={len(o['verts'])} welded={len(wv2)}"


def render(engine, label):
    reset()
    make("Box")
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (7, -7, 5)
    import mathutils
    cam.rotation_euler = (mathutils.Vector((0, 0, 0.7)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = 320, 200
    if engine == "CYCLES":
        sc.cycles.device = "CPU"
        sc.cycles.samples = 4
    sc.render.filepath = os.path.join(out, f"{label}.png")
    bpy.ops.render.render(write_still=True)
    return f"{os.path.getsize(sc.render.filepath)} bytes -> {sc.render.filepath}"


@probe("10 Cycles on CPU render from a scripted camera (needs no GL context)")
def _():
    return render("CYCLES", "cycles_cpu")


@probe("11 Workbench render from a scripted camera (LAST: a missing GL library aborts the process)")
def _():
    return render("BLENDER_WORKBENCH", "workbench")
