"""Pure-Python mesh checks for agent-built assets. No bpy, no numpy: every function takes plain lists.

Why this is a separate module: the Blender-facing script (blender_asset_check.py) only loads a file and extracts plain
data (world matrix, vertex tuples, face index tuples). Every judgement lives here, so each check can be shown to fail
on a known-bad mesh without launching Blender (test_asset_check_core.py does exactly that, with plain `python3`).

Conventions: vertices are (x, y, z) tuples; faces are index tuples (any length >= 3, counter-clockwise seen from
outside); matrices are 4x4 row-major lists of lists, the layout of a Blender object's `matrix_world`. Sizes are in
metres in the WORLD frame of the loaded scene (Blender: X right, Y forward, Z up after import).

Statuses: PASS, FAIL, SKIP (a check that did not run, always printed, never counted as a pass), INFO (a number, no
verdict). Written against the Blender 5.1 API reference; the Blender-facing script has not been run in Blender yet.
"""
import math
import re
from collections import defaultdict

DEFAULT_SCENE_NAMES = {"Cube", "Light", "Camera"}
DUP_SUFFIX = re.compile(r"\.\d{3}$")


# ---------------------------------------------------------------- geometry helpers
def mat_apply(m, v):
    x, y, z = v
    return (m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
            m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
            m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3])


def mat_scale(m):
    """Per-axis scale of a world matrix: the length of each basis column (always >= 0)."""
    return tuple(math.sqrt(m[0][c] ** 2 + m[1][c] ** 2 + m[2][c] ** 2) for c in range(3))


def mat_det3(m):
    a, b, c = m[0][0], m[0][1], m[0][2]
    d, e, f = m[1][0], m[1][1], m[1][2]
    g, h, i = m[2][0], m[2][1], m[2][2]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


def to_world(verts, m):
    return [mat_apply(m, v) for v in verts]


def bbox(verts):
    xs, ys, zs = zip(*verts)
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def bbox_size(lo, hi):
    return tuple(h - l for l, h in zip(lo, hi))


def weld(verts, faces, dist):
    """Merge vertices closer than ~dist (grid quantisation) and drop faces that collapse below 3 corners.
    Exporters split vertices per normal or UV, which makes a closed mesh look open until it is welded."""
    if dist <= 0:
        return list(verts), [tuple(f) for f in faces]
    index, new_verts, remap = {}, [], []
    for v in verts:
        key = (round(v[0] / dist), round(v[1] / dist), round(v[2] / dist))
        if key not in index:
            index[key] = len(new_verts)
            new_verts.append(v)
        remap.append(index[key])
    new_faces = []
    for f in faces:
        loop = []
        for i in f:
            j = remap[i]
            if not loop or loop[-1] != j:
                loop.append(j)
        if len(loop) > 1 and loop[0] == loop[-1]:
            loop.pop()
        if len(loop) >= 3 and len(set(loop)) >= 3:
            new_faces.append(tuple(loop))
    return new_verts, new_faces


def tri_count(faces):
    return sum(len(f) - 2 for f in faces)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def face_area(verts, f):
    o = verts[f[0]]
    tx = ty = tz = 0.0
    for k in range(1, len(f) - 1):
        c = _cross(_sub(verts[f[k]], o), _sub(verts[f[k + 1]], o))
        tx += c[0]; ty += c[1]; tz += c[2]
    return 0.5 * math.sqrt(tx * tx + ty * ty + tz * tz)


def degenerate_faces(verts, faces, eps=1e-10):
    return sum(1 for f in faces if face_area(verts, f) < eps)


def signed_volume(verts, faces):
    """Sum of signed tetrahedra against the origin. Positive for a closed mesh with outward winding.
    Compute it on WORLD coordinates so a mirrored (negative-determinant) object shows its flipped winding.
    One number per object cannot see a partial flip: use edge_report().inconsistent for that."""
    vol = 0.0
    for f in faces:
        a = verts[f[0]]
        for k in range(1, len(f) - 1):
            b, c = verts[f[k]], verts[f[k + 1]]
            cr = _cross(b, c)
            vol += (a[0] * cr[0] + a[1] * cr[1] + a[2] * cr[2]) / 6.0
    return vol


def edge_report(faces):
    """Directed-edge counting on a welded mesh.
    open: edges used by one face. over: edges used by 3+ faces. inconsistent: edges used by two faces that
    traverse it in the same direction (neighbouring faces disagree about which way is out: a partial normal flip)."""
    uses = defaultdict(list)
    for f in faces:
        n = len(f)
        for i in range(n):
            a, b = f[i], f[(i + 1) % n]
            if a == b:
                continue
            uses[(a, b) if a < b else (b, a)].append(1 if a < b else -1)
    return dict(
        edges=len(uses),
        open=sum(1 for d in uses.values() if len(d) == 1),
        over=sum(1 for d in uses.values() if len(d) > 2),
        inconsistent=sum(1 for d in uses.values() if len(d) == 2 and d[0] == d[1]))


def island_count(faces):
    """Connected components over shared vertices (loose parts inside one object). Weld first."""
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for f in faces:
        for i in f:
            parent.setdefault(i, i)
        r = find(f[0])
        for i in f[1:]:
            ri = find(i)
            if ri != r:
                parent[ri] = r
    return len({find(i) for i in parent})


def aabb_gap(a, b):
    """Distance between two axis-aligned boxes ((lo),(hi)); 0 when they overlap or touch."""
    s = 0.0
    for k in range(3):
        d = max(0.0, a[0][k] - b[1][k], b[0][k] - a[1][k])
        s += d * d
    return math.sqrt(s)


def touch_components(boxes, gap):
    """Connected components of the 'bounding boxes within gap' graph. More than one means a part floats clear of
    the rest. Boxes only: a part sunk inside another box, or a hair away on a tilted surface, is not seen."""
    n = len(boxes)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i in range(n):
        for j in range(i + 1, n):
            if aabb_gap(boxes[i], boxes[j]) <= gap:
                parent[find(i)] = find(j)
    return len({find(i) for i in range(n)})


def size_check(got, expected, tol, sorted_mode=False):
    """Compare a size triple with an expected one per world axis (default). sorted_mode compares sorted extents, which
    cannot tell a car from the same car lying on its side: use it only when the axis frame is genuinely unknown."""
    g = sorted(got) if sorted_mode else list(got)
    e = sorted(expected) if sorted_mode else list(expected)
    bad = [i for i in range(3) if abs(g[i] - e[i]) > tol * max(abs(e[i]), 1e-6)]
    return (not bad), g, e


def box_mesh(dims, center=(0.0, 0.0, 0.0)):
    """Closed box, outward winding. For tests and fixtures. dims = (x, y, z) full extents."""
    hx, hy, hz = (d / 2.0 for d in dims)
    cx, cy, cz = center
    verts = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
             (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz), (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (3, 0, 4, 7), (1, 2, 6, 5)]
    return verts, faces


IDENTITY = [[1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 1.0, 0], [0, 0, 0, 1.0]]


# ---------------------------------------------------------------- the checks
class Options:
    """Plain attribute bag; the script fills it from the command line, tests build it directly."""
    def __init__(self, **kw):
        self.profile = "solid"          # solid: must be closed with positive volume. surface: open meshes allowed
        self.max_tris = 0               # 0 = report only
        self.max_islands = 0            # 0 = report only (loose parts per object)
        self.merge_dist = 1e-5          # metres, weld before topology tests
        self.expect_size = None         # (x, y, z) in world axes, metres
        self.size_tol = 0.05
        self.size_sorted = False        # explicit opt-in; see size_check
        self.touch_gap = 0.0            # >0: every object must touch another within this gap (floating-part test)
        self.check_scale = False        # FAIL when world scale is not 1
        self.scale_mode = "check"       # check | skip_fbx (importer compensation makes scale non-evidence)
        self.require_uv = False
        self.allow_modifiers = False
        self.allow_negative_scale = False
        self.allow_dup_suffix = False
        self.name_regex = None
        self.source_kind = "gltf"       # gltf | fbx | blend
        self.sidecar = None             # {"objects": {name: {"tris": n, "size_m": [x, y, z], "tol": 0.02}}}
        for k, v in kw.items():
            if not hasattr(self, k):
                raise TypeError("unknown option " + k)
            setattr(self, k, v)


def _row(rows, status, scope, check, msg):
    rows.append(dict(status=status, scope=scope, check=check, msg=msg))


def check_object(obj, o):
    """obj: dict(name, verts, faces, matrix_world, modifiers, shape_keys, uv_layers, materials).
    Returns (rows, info) where info carries tris/size/box for the scene-level checks."""
    rows, name = [], obj["name"]
    m = obj["matrix_world"]
    wv = to_world(obj["verts"], m) if obj["verts"] else []
    if not obj["faces"] or not wv:
        _row(rows, "FAIL", name, "geometry", "mesh has no faces")
        return rows, None
    tris = tri_count(obj["faces"])
    lo, hi = bbox(wv)
    size = bbox_size(lo, hi)
    wverts, wfaces = weld(wv, obj["faces"], o.merge_dist)
    er = edge_report(wfaces)
    det = mat_det3(m)
    info = dict(name=name, tris=tris, size=size, box=(lo, hi), materials=obj["materials"], det=det)

    if o.max_tris and tris > o.max_tris:
        _row(rows, "FAIL", name, "tris", f"{tris} > {o.max_tris}")
    else:
        _row(rows, "PASS" if o.max_tris else "INFO", name, "tris", f"{tris}" + (f" <= {o.max_tris}" if o.max_tris else " (no ceiling given)"))

    dg = degenerate_faces(wverts, wfaces)
    _row(rows, "FAIL" if dg else "PASS", name, "degenerate faces", f"{dg} zero-area faces")

    _row(rows, "FAIL" if er["inconsistent"] else "PASS", name, "winding",
         f"{er['inconsistent']} edges where neighbouring faces disagree about which side is out (partial normal flip)")

    if o.profile == "solid":
        bad = er["open"] + er["over"]
        _row(rows, "FAIL" if bad else "PASS", name, "closed",
             f"{er['open']} open edges, {er['over']} edges shared by 3+ faces after welding at {o.merge_dist} m "
             f"(a genuinely open asset needs --profile surface)")
        if bad:
            _row(rows, "SKIP", name, "volume", "mesh is not closed; volume sign is not meaningful (see the closed FAIL above)")
        else:
            vol = signed_volume(wverts, wfaces)
            _row(rows, "FAIL" if vol <= 0 else "PASS", name, "volume",
                 f"world-space signed volume {vol:.4f} m3 (<= 0 means inward normals or a mirrored transform)")
    else:
        _row(rows, "INFO", name, "closed", f"surface profile: {er['open']} open edges, {er['over']} edges shared by 3+ faces (not judged)")
        _row(rows, "SKIP", name, "volume", "surface profile has no volume")

    isl = island_count(wfaces)
    if o.max_islands and isl > o.max_islands:
        _row(rows, "FAIL", name, "islands", f"{isl} loose parts > {o.max_islands}")
    else:
        _row(rows, "PASS" if o.max_islands else "INFO", name, "islands", f"{isl} loose parts" + (f" <= {o.max_islands}" if o.max_islands else " (no limit given)"))

    sc = mat_scale(m)
    if o.scale_mode == "skip_fbx":
        _row(rows, "SKIP", name, "scale", f"world scale {tuple(round(s, 4) for s in sc)}: an FBX re-import carries importer "
             "compensation, so transform scale is not evidence; the world-size check is (and is then required)")
    elif o.check_scale:
        bad = [s for s in sc if abs(s - 1.0) > 1e-4]
        _row(rows, "FAIL" if bad else "PASS", name, "scale", f"world scale {tuple(round(s, 4) for s in sc)}")
    else:
        _row(rows, "INFO", name, "scale", f"world scale {tuple(round(s, 4) for s in sc)} (--check-scale not given)")

    if det < 0 and not o.allow_negative_scale:
        _row(rows, "FAIL", name, "mirror", "negative world determinant: a mirrored transform flips winding in many exporters")

    if o.source_kind == "blend":
        if obj["modifiers"] and obj["shape_keys"]:
            _row(rows, "FAIL", name, "modifiers", f"{obj['modifiers']} modifiers on a mesh with shape keys: applying modifiers at export drops shape keys")
        elif obj["modifiers"] and not o.allow_modifiers:
            _row(rows, "FAIL", name, "modifiers", f"{obj['modifiers']} modifiers present: apply them in the script or state that the exporter applies them (--allow-modifiers)")
        else:
            _row(rows, "PASS", name, "modifiers", f"{obj['modifiers']} modifiers")
    else:
        _row(rows, "SKIP", name, "modifiers", "a re-imported file carries no modifiers; check the .blend")

    if o.require_uv:
        _row(rows, "FAIL" if not obj["uv_layers"] else "PASS", name, "uv", f"{obj['uv_layers']} UV layers")

    bad_dup = bool(DUP_SUFFIX.search(name)) and not o.allow_dup_suffix
    bad_re = bool(o.name_regex) and not re.match(o.name_regex, name)
    if bad_dup or bad_re:
        _row(rows, "FAIL", name, "name", ("duplicate suffix like .001 (Blender adds it silently on a clash); " if bad_dup else "") +
             (f"does not match {o.name_regex}" if bad_re else ""))

    if o.sidecar and name in o.sidecar.get("objects", {}):
        want = o.sidecar["objects"][name]
        probs = []
        if "tris" in want and want["tris"] != tris:
            probs.append(f"tris {tris} != sidecar {want['tris']}")
        if "size_m" in want:
            ok, g, e = size_check(size, want["size_m"], want.get("tol", 0.02))
            if not ok:
                probs.append(f"size {[round(x, 3) for x in g]} != sidecar {[round(x, 3) for x in e]}")
        _row(rows, "FAIL" if probs else "PASS", name, "sidecar", "; ".join(probs) or "matches the sidecar entry")
    return rows, info


def check_scene(objs, o):
    """objs: list of extracted mesh-object dicts. Returns (rows, infos)."""
    rows, infos = [], []
    if not objs:
        _row(rows, "FAIL", "scene", "empty", "no mesh objects found (an empty import must never read as a pass)")
        return rows, infos
    names = {x["name"] for x in objs}
    if o.source_kind == "blend" and names <= DEFAULT_SCENE_NAMES:
        _row(rows, "FAIL", "scene", "default scene", "only Blender's default objects found: the checker is looking at the wrong file or state")
    for x in objs:
        r, info = check_object(x, o)
        rows += r
        if info:
            infos.append(info)
    if infos:
        lo = tuple(min(i["box"][0][k] for i in infos) for k in range(3))
        hi = tuple(max(i["box"][1][k] for i in infos) for k in range(3))
        size = bbox_size(lo, hi)
        if o.expect_size:
            ok, g, e = size_check(size, o.expect_size, o.size_tol, o.size_sorted)
            _row(rows, "PASS" if ok else "FAIL", "scene", "size" + (" (sorted axes)" if o.size_sorted else ""),
                 f"world size {[round(x, 3) for x in g]} vs expected {[round(x, 3) for x in e]} tol {o.size_tol}")
        else:
            _row(rows, "INFO", "scene", "size", f"world size {[round(x, 3) for x in size]} (no --expect-size given)")
        if o.scale_mode == "skip_fbx" and not o.expect_size:
            _row(rows, "FAIL", "scene", "scale evidence", "FBX input without --expect-size: nothing proves the scale; give the expected world size")
        if o.touch_gap > 0:
            n = touch_components([i["box"] for i in infos], o.touch_gap)
            _row(rows, "FAIL" if n > 1 else "PASS", "scene", "touching",
                 f"{n} groups of objects whose bounding boxes lie within {o.touch_gap} m of each other (more than 1 = a part floats)")
    return rows, infos


def summarize(rows, fail_on_skip=False):
    c = {"PASS": 0, "FAIL": 0, "SKIP": 0, "INFO": 0}
    for r in rows:
        c[r["status"]] += 1
    failed = c["FAIL"] > 0 or (fail_on_skip and c["SKIP"] > 0)
    return c, failed


def format_row(r):
    return f"{r['status']:4} {r['scope']:18} {r['check']:16} {r['msg']}"
