#!/usr/bin/env bash
# Build dist/the-high-council-<version>.mcpb, a Claude Desktop bundle, from exactly what npm would
# publish: the npm tarball's files, its production dependencies, mcpb/manifest.json and the icon.
# Offline apart from `npm install` of the dependencies and the first `npx @anthropic-ai/mcpb`.
# Calls no model and needs no key. Signing is a separate, manual step (see mcpb/README.md).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
version="$(node -p "require('./package.json').version")"
manifest_version="$(node -p "require('./mcpb/manifest.json').version")"
if [ "$version" != "$manifest_version" ]; then
  echo "mcpb/manifest.json is $manifest_version, package.json is $version - bump them together" >&2
  exit 1
fi
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
tarball="$(npm pack --silent --pack-destination "$stage")"
tar -xzf "$stage/$tarball" -C "$stage"
bundle="$stage/package"
# No .mcpbignore: the npm tarball already leaves out runs/, tasks/, .env and docs/, and an
# unanchored ignore pattern such as `tasks/` also strips same-named folders inside node_modules
# (it removed part of @modelcontextprotocol/sdk in a trial build, and the server would not start).
cp mcpb/manifest.json "$bundle/"
cp docs/logo-diamond.png "$bundle/icon.png"
(cd "$bundle" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --silent)
mkdir -p dist
npx --yes @anthropic-ai/mcpb@2 validate "$bundle/manifest.json"
npx --yes @anthropic-ai/mcpb@2 pack "$bundle" "dist/the-high-council-$version.mcpb"
shasum -a 256 "dist/the-high-council-$version.mcpb" 2>/dev/null || sha256sum "dist/the-high-council-$version.mcpb"
