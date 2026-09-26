# Claude Desktop bundle (`.mcpb`)

`manifest.json` here describes The High Council as an MCP Bundle: one file a Claude Desktop user
double-clicks to install the MCP server, with the app's own settings form for the values below.
The bundle is not in the npm package; it is built from it. Each release's bundle and its SHA-256
are attached to the release on the GitHub Releases page.

## Build

```bash
bash scripts/build-mcpb.sh      # -> dist/the-high-council-<version>.mcpb and its SHA-256
```

The script packs the npm tarball, installs its production dependencies, adds this manifest and the
icon, validates the manifest and packs the bundle. It calls no model and needs no key.

## What the install form asks for

| Setting | Passed to the server as | Notes |
|---|---|---|
| Council folder (required) | `COUNCIL_WORKDIR` | Tasks and run folders go here. The bundle format has no working-directory setting, so without it runs would land wherever the app starts the server. |
| Spend ceiling per run (required, default $7) | `MAX_USD_PER_RUN` and `COUNCIL_MAX_USD_LIMIT` | The second makes it a ceiling Claude cannot raise, or remove with `max_usd: 0`, from a conversation. |
| One key per provider (all optional, empty by default) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ... | Marked `sensitive`, so the app keeps them in the OS keychain. There is no default key and none is ever shipped. The `mock` chains need no key. A key is sent only to its own provider's https API. |

## Sign (optional)

Unsigned bundles install. To sign: `npx @anthropic-ai/mcpb sign dist/<file>.mcpb --cert cert.pem --key key.pem`
with a code-signing certificate, then `npx @anthropic-ai/mcpb verify dist/<file>.mcpb`.
`--self-signed` is for testing only.

## Keep in step

`test/distribution-manifests.test.js` fails if the manifest's version differs from `package.json`,
if its tool list differs from the tools `src/mcp/server.js` registers, or if any key setting is not
optional, sensitive and empty by default.
