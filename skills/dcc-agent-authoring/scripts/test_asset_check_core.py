"""Runs WITHOUT Blender: `python3 test_asset_check_core.py`. One known-bad input per check, plus the good case.
These tests show each check can fail; they do not show the Blender-facing glue works (that needs run_checks.sh in Blender)."""
import math
import unittest

import asset_check_core as core
from asset_check_core import Options, IDENTITY, box_mesh


def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [[1.0, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1.0]]


def mirror_x():
    return [[-1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 1.0, 0], [0, 0, 0, 1.0]]


def obj(name, verts, faces, m=IDENTITY, **kw):
    d = dict(name=name, verts=verts, faces=faces, matrix_world=m, modifiers=0, shape_keys=False, uv_layers=1, materials=1)
    d.update(kw)
    return d


def box_obj(name="Body", dims=(2.0, 4.5, 1.4), center=(0, 0, 0.7), m=IDENTITY):
    v, f = box_mesh(dims, center)
    return obj(name, v, f, m)


def status(rows, check, scope=None):
    got = [r["status"] for r in rows if r["check"].startswith(check) and (scope is None or r["scope"] == scope)]
    assert got, f"no row for {check}: {[r['check'] for r in rows]}"
    return got


def run(objs, **kw):
    rows, _ = core.check_scene(objs, Options(**kw))
    return rows


class GoodBox(unittest.TestCase):
    def test_upright_box_passes_everything(self):
        rows = run([box_obj()], expect_size=(2.0, 4.5, 1.4), max_tris=100, check_scale=True, max_islands=1, touch_gap=0.01)
        self.assertEqual([r for r in rows if r["status"] == "FAIL"], [])
        counts, failed = core.summarize(rows)
        self.assertFalse(failed)
        self.assertEqual(status(rows, "volume"), ["PASS"])

    def test_volume_is_positive_for_the_fixture_box(self):
        v, f = box_mesh((2.0, 4.5, 1.4), (0, 0, 0.7))
        self.assertAlmostEqual(core.signed_volume(v, f), 2.0 * 4.5 * 1.4, places=6)


class OrientedSize(unittest.TestCase):
    def test_box_lying_on_its_side_fails_oriented_size(self):
        # the same box rotated 90 degrees about X: world size becomes (2.0, 1.4, 4.5)
        v, f = box_mesh((2.0, 4.5, 1.4), (0, 0, 0))
        rows = run([obj("Body", v, f, rot_x(90))], expect_size=(2.0, 4.5, 1.4))
        self.assertEqual(status(rows, "size", "scene"), ["FAIL"])

    def test_sorted_mode_is_blind_to_the_same_error(self):
        v, f = box_mesh((2.0, 4.5, 1.4), (0, 0, 0))
        rows = run([obj("Body", v, f, rot_x(90))], expect_size=(2.0, 4.5, 1.4), size_sorted=True)
        self.assertEqual(status(rows, "size", "scene"), ["PASS"])  # documents why sorted is opt-in only

    def test_wrong_height_fails(self):
        rows = run([box_obj()], expect_size=(2.0, 4.5, 3.0))
        self.assertEqual(status(rows, "size", "scene"), ["FAIL"])


class Topology(unittest.TestCase):
    def test_open_plane_fails_solid_and_passes_surface(self):
        v = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        plane = obj("Road", v, [(0, 1, 2, 3)])
        self.assertEqual(status(run([plane]), "closed"), ["FAIL"])
        rows = run([plane], profile="surface")
        self.assertNotIn("FAIL", [r["status"] for r in rows])
        self.assertEqual(status(rows, "volume"), ["SKIP"])  # skipped checks are printed, never silent

    def test_partial_flip_fails_winding_even_though_volume_sign_stays_positive(self):
        v, f = box_mesh((2.0, 4.5, 1.4), (0, 0, 0))
        f = [tuple(reversed(f[0]))] + f[1:]   # flip one face only
        vol = core.signed_volume(v, f)
        self.assertGreater(vol, 0)            # the single-number sign test would pass this mesh
        rows = run([obj("Body", v, f)])
        self.assertEqual(status(rows, "winding"), ["FAIL"])

    def test_all_faces_inverted_fails_volume(self):
        v, f = box_mesh((2.0, 4.5, 1.4), (0, 0, 0))
        rows = run([obj("Body", v, [tuple(reversed(x)) for x in f])])
        self.assertEqual(status(rows, "volume"), ["FAIL"])
        self.assertEqual(status(rows, "winding"), ["PASS"])

    def test_mirrored_transform_is_caught_in_world_space(self):
        rows = run([box_obj(m=mirror_x())])
        self.assertEqual(status(rows, "volume"), ["FAIL"])
        self.assertEqual(status(rows, "mirror"), ["FAIL"])
        allowed = run([box_obj(m=mirror_x())], allow_negative_scale=True)
        self.assertNotIn("mirror", [r["check"] for r in allowed])

    def test_split_vertices_look_open_until_welded(self):
        # exporters write one vertex per (position, normal): 24 vertices for a box
        v, f = box_mesh((1, 1, 1))
        sv, sf = [], []
        for face in f:
            base = len(sv)
            sv += [v[i] for i in face]
            sf.append(tuple(range(base, base + len(face))))
        self.assertGreater(core.edge_report(sf)["open"], 0)
        wv, wf = core.weld(sv, sf, 1e-5)
        self.assertEqual(len(wv), 8)
        self.assertEqual(core.edge_report(wf)["open"], 0)
        self.assertEqual(status(run([obj("Body", sv, sf)]), "closed"), ["PASS"])

    def test_zero_area_face_fails(self):
        v, f = box_mesh((1, 1, 1))
        v = v + [(5, 5, 5), (6, 5, 5), (7, 5, 5)]  # three collinear points
        rows = run([obj("Body", v, f + [(8, 9, 10)])], profile="surface")
        self.assertEqual(status(rows, "degenerate"), ["FAIL"])

    def test_triangle_ceiling(self):
        self.assertEqual(status(run([box_obj()], max_tris=5), "tris"), ["FAIL"])
        self.assertEqual(core.tri_count(box_mesh((1, 1, 1))[1]), 12)


class Parts(unittest.TestCase):
    def test_two_disjoint_boxes_in_one_object_exceed_one_island(self):
        v1, f1 = box_mesh((1, 1, 1), (0, 0, 0))
        v2, f2 = box_mesh((1, 1, 1), (5, 0, 0))
        f2 = [tuple(i + 8 for i in face) for face in f2]
        rows = run([obj("Body", v1 + v2, f1 + f2)], max_islands=1)
        self.assertEqual(status(rows, "islands"), ["FAIL"])

    def test_floating_object_fails_touching(self):
        body = box_obj("Body", (2, 2, 1), (0, 0, 0.5))
        wing = box_obj("Wing", (1, 1, 1), (0, 0, 3.0))      # 1.5 m above the body's top face
        rows = run([body, wing], touch_gap=0.05)
        self.assertEqual(status(rows, "touching", "scene"), ["FAIL"])
        wing_ok = box_obj("Wing", (1, 1, 1), (0, 0, 1.5))   # sitting on the body
        self.assertEqual(status(run([body, wing_ok], touch_gap=0.05), "touching", "scene"), ["PASS"])


class SceneGuards(unittest.TestCase):
    def test_empty_scene_fails(self):
        rows, _ = core.check_scene([], Options())
        self.assertEqual(status(rows, "empty"), ["FAIL"])

    def test_default_blender_scene_fails_for_blend_files(self):
        rows = run([box_obj("Cube")], source_kind="blend")
        self.assertEqual(status(rows, "default scene"), ["FAIL"])

    def test_empty_mesh_fails(self):
        rows = run([obj("Body", [], [])])
        self.assertEqual(status(rows, "geometry"), ["FAIL"])


class ScaleAndNames(unittest.TestCase):
    def test_unapplied_scale_fails_in_world_matrix(self):
        m = [[0.01, 0, 0, 0], [0, 0.01, 0, 0], [0, 0, 0.01, 0], [0, 0, 0, 1.0]]
        self.assertEqual(status(run([box_obj(m=m)], check_scale=True), "scale"), ["FAIL"])

    def test_fbx_scale_is_skipped_loudly_and_needs_a_size(self):
        m = [[0.01, 0, 0, 0], [0, 0.01, 0, 0], [0, 0, 0.01, 0], [0, 0, 0, 1.0]]
        rows = run([box_obj(m=m)], scale_mode="skip_fbx", check_scale=True, source_kind="fbx")
        self.assertEqual(status(rows, "scale", "Body"), ["SKIP"])
        self.assertEqual(status(rows, "scale evidence", "scene"), ["FAIL"])  # no --expect-size: nothing proves the scale
        # with a size that matches the WORLD extents (box 1 m scaled by 0.01 is 0.01 m, so give that):
        rows = run([box_obj(m=m)], scale_mode="skip_fbx", source_kind="fbx", expect_size=(0.02, 0.045, 0.014))
        self.assertEqual(status(rows, "size", "scene"), ["PASS"])
        counts, failed = core.summarize(rows, fail_on_skip=True)
        self.assertTrue(failed)  # --fail-on-skip makes a skip fail

    def test_duplicate_suffix_and_name_regex(self):
        self.assertEqual(status(run([box_obj("Body.001")]), "name"), ["FAIL"])
        self.assertEqual(status(run([box_obj("Body")], name_regex=r"^wheel_"), "name"), ["FAIL"])

    def test_modifiers_and_shape_keys_in_blend(self):
        o1 = box_obj(); o1["modifiers"] = 2
        self.assertEqual(status(run([o1], source_kind="blend"), "modifiers"), ["FAIL"])
        self.assertEqual(status(run([o1], source_kind="blend", allow_modifiers=True), "modifiers"), ["PASS"])
        o2 = box_obj(); o2["modifiers"] = 1; o2["shape_keys"] = True
        self.assertEqual(status(run([o2], source_kind="blend", allow_modifiers=True), "modifiers"), ["FAIL"])
        self.assertEqual(status(run([box_obj()], source_kind="gltf"), "modifiers"), ["SKIP"])

    def test_missing_uv(self):
        o1 = box_obj(); o1["uv_layers"] = 0
        self.assertEqual(status(run([o1], require_uv=True), "uv"), ["FAIL"])

    def test_sidecar_disagreement(self):
        side = {"objects": {"Body": {"tris": 12, "size_m": [2.0, 4.5, 1.4]}}}
        self.assertEqual(status(run([box_obj()], sidecar=side), "sidecar"), ["PASS"])
        bad = {"objects": {"Body": {"tris": 99}}}
        self.assertEqual(status(run([box_obj()], sidecar=bad), "sidecar"), ["FAIL"])


class OptionsGuard(unittest.TestCase):
    def test_unknown_option_raises(self):
        with self.assertRaises(TypeError):
            Options(max_tri=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
