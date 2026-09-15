# Registering The High Council as an MCP server

The High Council already runs as an MCP server (`npm run mcp` / `src/mcp/server.js`, see the
README's own "Quick start (MCP)" section). Every client below already speaks MCP natively - none
of this needs any new code in this repo. Point each one at the same server entry point:

```bash
npx -y github:muad-yasin/the-high-council-mcp council --mcp
```

or, from a local clone/install:

```bash
node /absolute/path/to/the-high-council-mcp/src/mcp/server.js
```

**The path must be absolute** for the local-clone form - a client starts the server from its own
working directory, not this repo's, so a relative path resolves somewhere unexpected.

No efficacy claim is made about how well any of these tools' agents make use of The High Council's
tools once registered - this page only covers registration.

## 1. DeepSeek Harness (DSH)

DeepSeek's own official coding-agent harness (`npx @deepseek-ai/dsh`, `github.com/deepseek-ai/deepseek-harness`).
**Developer preview as of this writing** - DeepSeek's own docs warn that config syntax may change
between releases; verify the shape below against DSH's current docs before depending on it in a
real workflow.

DSH ships MCP support as a built-in plugin, `@deepseek-ai/dsh-mcp-client` - no separate install
step. Add an entry to DSH's own config file, `cordis.yml`:

```yaml
- id: high-council
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: high-council
    transport: stdio
    command: npx
    args: ['-y', 'github:muad-yasin/the-high-council-mcp', 'council', '--mcp']
```

Once registered, The High Council's tools appear to the DSH agent under DSH's server-qualified
naming convention (`mcp__high-council__<toolName>`), the same shape Claude Code and Codex use.

**As of this writing, `dsh-mcp-client` only bridges MCP's Tools capability** - Resources and
Prompts are documented by DeepSeek as deferred, with no harness-side consumer yet. The High
Council's MCP surface is tools-only, so this limitation doesn't affect what's usable here.

## 2. OpenHands

Real, first-party MCP support, both via CLI command and a config file
(`docs.openhands.dev/openhands/usage/cli/mcp-servers`).

Via the CLI:

```bash
openhands mcp add high-council --transport stdio npx -- -y github:muad-yasin/the-high-council-mcp council --mcp
```

Or edit `~/.openhands/mcp.json` directly:

```json
{
  "mcpServers": {
    "high-council": {
      "command": "npx",
      "args": ["-y", "github:muad-yasin/the-high-council-mcp", "council", "--mcp"]
    }
  }
}
```

OpenHands also supports an in-conversation `/mcp` command and `openhands mcp` subcommands to
list/enable/disable registered servers once added.

## 3. Cline

MCP tool calls are a named part of Cline's own action surface. Cline keeps its own settings file,
separate from VS Code's generic `.vscode/mcp.json`:

- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "high-council": {
      "command": "npx",
      "args": ["-y", "github:muad-yasin/the-high-council-mcp", "council", "--mcp"]
    }
  }
}
```

Cline's own "Configure MCP Servers" panel in the extension UI can also add/edit this file directly
without hand-editing JSON, if preferred.

## 4. goose

goose models its entire tool surface - including its own built-in capabilities - as MCP
extensions, so The High Council registers the same way any other extension does. Either run the
interactive wizard:

```bash
goose configure
# -> Add Extension -> Command-line Extension (STDIO)
# name: high-council
# command: npx -y github:muad-yasin/the-high-council-mcp council --mcp
```

or edit goose's own config file directly (`~/.config/goose/config.yaml` on macOS/Linux,
`%APPDATA%\Block\goose\config\config.yaml` on Windows):

```yaml
extensions:
  high-council:
    type: stdio
    cmd: npx
    args: ['-y', 'github:muad-yasin/the-high-council-mcp', 'council', '--mcp']
    timeout: 300
```

## 5. Continue

MCP servers plug directly into Continue's context-provider surface - the same `@`-invokable
mechanism as its built-in providers. Add an entry to Continue's `config.yaml`:

```yaml
mcpServers:
  - name: High Council
    command: npx
    args:
      - '-y'
      - 'github:muad-yasin/the-high-council-mcp'
      - 'council'
      - '--mcp'
```

## A note on local clones

Every example above uses the `npx -y github:...` form, which needs no clone. If you'd rather run
from a local clone (e.g. to track an unreleased branch), swap the `command`/`args` pair for the
absolute-path form the README's own MCP section uses:

```
command: node
args: ['/absolute/path/to/the-high-council-mcp/src/mcp/server.js']
```
