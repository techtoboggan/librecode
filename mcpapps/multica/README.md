# `@librecode/multica-mcp-app`

An MCP App that embeds [Multica](https://github.com/multica-ai/multica)'s
Linear-style kanban board into LibreCode (or any other MCP-Apps host) and
gives the agent three tools to keep its work mirrored on the board:

- **`multica_create_issue`** — open a card at the start of substantial work.
- **`multica_update_status`** — move the card between columns
  (`backlog` → `todo` → `in_progress` → `in_review` → `done` / `blocked` /
  `cancelled`).
- **`multica_add_comment`** — append progress notes to the card.

The board itself renders inside the host's iframe panel via the
`ui://multica/board` resource — point it at any self-hosted Multica
workspace and you get a live Linear-style kanban without leaving the
agent UI.

## Why this lives in the LibreCode monorepo (for now)

The eventual home for this package is `github.com/techtoboggan/librecode-multica-mcp-app`.
For v0.9.76 it lives at `mcpapps/multica/` inside the LibreCode repo so we
can iterate on it alongside the host's MCP-Apps surface. Nothing in this
package imports from other LibreCode packages — the future
`git filter-repo` extraction is a single command.

## Prerequisites

1. A running self-hosted Multica instance:

   ```bash
   # From the multica repo
   docker compose -f docker-compose.selfhost.yml up -d
   ```

   By default the backend is on `http://localhost:8080` and the web UI is
   on `http://localhost:3000`.

2. A Multica Personal Access Token (`mul_…` prefix). Create one in the
   Multica UI under **Settings → Personal Access Tokens**.

3. Your workspace slug (the path segment in `https://multica/<slug>/...`).

## Install + connect to LibreCode

LibreCode v0.9.73+ ships a non-interactive `mcp add` command. From the
repo root:

```bash
librecode mcp add multica \
  --local "bun run mcpapps/multica/src/index.ts" \
  --global --json
```

That registers the MCP server in `~/.config/librecode/librecode.jsonc`.
Set the runtime environment in the same config under `command.environment`:

```jsonc
{
  "mcp": {
    "multica": {
      "type": "local",
      "command": ["bun", "run", "/path/to/librecode/mcpapps/multica/src/index.ts"],
      "environment": {
        "MULTICA_BASE_URL": "http://localhost:8080",
        "MULTICA_TOKEN": "mul_xxxxxxxxxxxxxxxx",
        "MULTICA_WORKSPACE_SLUG": "acme",
        "MULTICA_WEB_URL": "http://localhost:3000",
      },
    },
  },
}
```

Restart LibreCode. Open the **Start menu → Multica Board** to launch the
embedded kanban; the three tools become available to whichever agent has
permission to use them.

## Configuration

| Env var                  | Required | Default                 | Description                                                             |
| ------------------------ | -------- | ----------------------- | ----------------------------------------------------------------------- |
| `MULTICA_BASE_URL`       | yes      | —                       | Multica REST API origin, e.g. `http://localhost:8080`                   |
| `MULTICA_TOKEN`          | yes      | —                       | PAT, prefix `mul_`. Sent as `Authorization: Bearer <token>`             |
| `MULTICA_WORKSPACE_SLUG` | yes      | —                       | Workspace short name (the `/<slug>/` segment in Multica URLs)           |
| `MULTICA_WEB_URL`        | no       | `http://localhost:3000` | Web UI origin used by the iframe embed                                  |
| `MULTICA_BOARD_PATH`     | no       | `/board`                | Path within the workspace to load — change to `/issues?view=board` etc. |

## Running standalone

```bash
cd mcpapps/multica
bun install
MULTICA_BASE_URL=http://localhost:8080 \
MULTICA_TOKEN=mul_xxxx \
MULTICA_WORKSPACE_SLUG=acme \
bun run src/index.ts
```

Then point any MCP-spec-compliant host at it via stdio.

## Tests

```bash
cd mcpapps/multica
bun test
```

22 unit tests covering the REST client (happy + error paths) and the MCP
server glue (config loading, board.html rendering, tool result shaping).
Network is stubbed via a fake `fetchFn` so tests run offline.

## Embedding caveats

- LibreCode runs MCP-app HTML inside a null-origin sandbox
  (`allow-scripts` only). The Multica web UI is loaded into a nested
  iframe with `sandbox="allow-scripts allow-forms allow-popups …"` —
  enough for the kanban to be navigable, but not for cookie-based auth.
  If you need authenticated Multica embeds, run the LibreCode + Multica
  pair on the same origin (reverse proxy) so cookies flow through.

- Multica's CSP middleware doesn't currently include
  `frame-ancestors` allowing LibreCode. For local dev this isn't
  enforced; for production embeds add `ALLOWED_ORIGINS=http://localhost:1420`
  (or your LibreCode origin) to Multica's `docker-compose.selfhost.yml`.

## License

MIT, matching LibreCode. Multica itself ships under a modified Apache 2.0
that adds restrictions on commercial redistribution — this MCP app
**connects to** Multica via its public REST API and embeds its already-
running web UI in an iframe; it does not include or redistribute any
Multica source. See Multica's
[LICENSE](https://github.com/multica-ai/multica/blob/main/LICENSE) for
your own deployment's obligations.
