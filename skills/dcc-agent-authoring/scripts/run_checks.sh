#!/usr/bin/env bash
# Runs, in order: (1) the pure-Python tests and mutation-free sanity of the checks (no Blender needed),
# (2) the probe, (3) fixture build (glTF and FBX), (4) the checker on the good fixtures (must pass) and on every bad fixture (each must FAIL), including the FBX path.
# Output goes to output-<tag>/ next to this script: keep it with the asset. NOT run yet: the first run is the real test.
# Usage: run_checks.sh /path/to/python-with-bpy [workdir]      (the bpy wheel version must equal your Blender binary)
#        EXPECT_BPY=5.1 run_checks.sh ...                      (the probe aborts on a version mismatch)
set -u
PY=${1:?path to a python with the bpy wheel}; W=${2:-$(mktemp -d)}; HERE=$(cd "$(dirname "$0")" && pwd)
TAG=$("$PY" -c "import bpy;print(bpy.app.version_string)" 2>/dev/null | tail -1); TAG=${TAG:-unknown}
OUT="$HERE/output-$TAG"; mkdir -p "$W" "$OUT"
export PYTHONDONTWRITEBYTECODE=1
echo "== pure checks (no Blender)"; (cd "$HERE" && "$PY" test_asset_check_core.py 2>&1 | tail -3) | tee "$OUT/pure_tests.txt"
echo "== probe";    "$PY" "$HERE/blender_probe.py" "$W" > "$OUT/probe.txt" 2>&1; echo "probe exit=$?"
echo "== fixtures"; "$PY" "$HERE/make_fixtures.py" "$W/fx" > "$OUT/fixtures.txt" 2>&1; echo "fixtures exit=$?"
{
  echo "--- good (must pass)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/good.glb" --expect-size 2.0 4.5 1.4 --max-tris 100 --max-islands 1 --check-scale 2>&1 | grep -E "^(PASS|FAIL|SKIP|INFO|summary|WARN)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- lying on its side (must FAIL on size)";  "$PY" "$HERE/blender_asset_check.py" "$W/fx/lying.glb" --expect-size 2.0 4.5 1.4 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- open plane under the solid profile (must FAIL)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/open.glb" 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- open plane under the surface profile (must pass, volume SKIP shown)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/open.glb" --profile surface 2>&1 | grep -E "^(FAIL|SKIP|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- one flipped face (must FAIL on winding)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/flipped_face.glb" 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- all faces inverted (must FAIL on volume)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/inverted.glb" 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- floating part (must FAIL on touching)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/floating.glb" --touch-gap 0.05 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- FBX good, with a size (must pass; transform scale is a printed SKIP, the size is the evidence)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/good.fbx" --expect-size 2.0 4.5 1.4 --max-tris 100 2>&1 | grep -E "^(PASS|FAIL|SKIP|WARN|importer|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- FBX good, no size (must FAIL on scale evidence)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/good.fbx" 2>&1 | grep -E "^(FAIL|SKIP|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- FBX lying on its side (must FAIL on size)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/lying.fbx" --expect-size 2.0 4.5 1.4 2>&1 | grep -E "^(FAIL|summary)"; echo "exit=${PIPESTATUS[0]}"
  echo "--- corrupt file (must FAIL)"; "$PY" "$HERE/blender_asset_check.py" "$W/fx/corrupt.glb" 2>&1 | grep -E "(Error|FAIL)" | head -2; echo "exit=${PIPESTATUS[0]}"
} > "$OUT/asset_check.txt"
echo "wrote $OUT/ (read asset_check.txt: every 'must FAIL' block needs exit=1, the passing blocks exit=0)"
