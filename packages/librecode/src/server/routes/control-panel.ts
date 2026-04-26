/**
 * v0.9.74 — Agentic Control Panel API.
 *
 * Read-only listings of LibreCode's four core primitive types
 * (agents, skills, plugins, tools) plus an `import` endpoint that
 * pulls skill/agent files from a curated catalog of public git
 * repositories (Superpowers, Anthropic skills library, etc. — see
 * `mcp/../importer/sources.ts`).
 *
 * Edit/delete/disable affordances are NOT in this release — the user
 * still edits config via librecode.jsonc or the existing
 * `librecode mcp` CLI for MCP servers. v0.9.75+ will layer
 * inline editing over these endpoints once the read path is proven.
 */
import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import z from "zod"
import { Agent } from "../../agent/agent"
import { Importer } from "../../importer"
import { Plugin } from "../../plugin"
import { Skill } from "../../skill"
import { ToolRegistry } from "../../tool/registry"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const ControlPanelRoutes = lazy(() =>
  new Hono()
    .get(
      "/agents",
      describeRoute({
        summary: "List configured agents",
        description:
          "Returns every agent visible to the host: built-in (build, plan, general, …), config-defined " +
          "(`[agent.<name>]` in librecode.jsonc), and v0.9.74 file-based (`~/.config/librecode/agents/<name>.md`).",
        operationId: "controlPanel.agents.list",
        responses: { 200: { description: "OK" } },
      }),
      async (c) => {
        const agents = await Agent.list()
        return c.json({
          agents: agents.map((a) => ({
            name: a.name,
            description: a.description,
            mode: a.mode,
            native: a.native ?? false,
            hidden: a.hidden ?? false,
            model: a.model,
            hasPrompt: typeof a.prompt === "string" && a.prompt.length > 0,
            promptPreview: typeof a.prompt === "string" ? a.prompt.slice(0, 280) : undefined,
          })),
        })
      },
    )
    .get(
      "/skills",
      describeRoute({
        summary: "List discovered skills",
        description:
          "Walks every skill discovery path (config dirs, ~/.claude/skills, ~/.agents/skills, project " +
          ".librecode/skills, etc.) and returns the parsed frontmatter + content preview for each.",
        operationId: "controlPanel.skills.list",
        responses: { 200: { description: "OK" } },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json({
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            location: s.location,
            preview: s.content.slice(0, 280),
          })),
        })
      },
    )
    .get(
      "/plugins",
      describeRoute({
        summary: "List loaded plugin hooks",
        description:
          "Returns the hook objects each loaded plugin contributed. Plugins are TS modules loaded from " +
          "npm or local file:// paths and provide things like provider auth flows + custom tools.",
        operationId: "controlPanel.plugins.list",
        responses: { 200: { description: "OK" } },
      }),
      async (c) => {
        const hooks = await Plugin.list()
        return c.json({
          plugins: hooks.map((h, i) => ({
            // Plugin hook objects are anonymous — we expose what the host can
            // actually see: which hook names they implement, indexed by load order.
            // A future plugin.json schema would let us surface a `name` here.
            index: i,
            hooks: Object.keys(h).filter((k) => typeof (h as Record<string, unknown>)[k] === "function"),
          })),
        })
      },
    )
    .get(
      "/tools",
      describeRoute({
        summary: "List registered tools",
        description:
          "Every tool the host has registered, with its id + description. Built-ins (bash, read, edit, …), " +
          "custom tools loaded from `<config>/tools/*.{js,ts}`, and plugin-contributed tools all surface here.",
        operationId: "controlPanel.tools.list",
        responses: { 200: { description: "OK" } },
      }),
      async (c) => {
        const tools = await ToolRegistry.descriptions()
        return c.json({ tools })
      },
    )
    .get(
      "/import-sources",
      describeRoute({
        summary: "List available import sources",
        description:
          "Curated catalog of public git repos that match LibreCode's skills/agents layout. The UI uses " +
          "this to populate the import dialog.",
        operationId: "controlPanel.import.sources",
        responses: { 200: { description: "OK" } },
      }),
      async (c) => {
        return c.json({ sources: Importer.sources() })
      },
    )
    .post(
      "/import",
      describeRoute({
        summary: "Import skills + agents from a catalog source",
        description:
          "Clones (or refreshes) the source's git repo into the LibreCode cache and copies its skill + " +
          "agent files into `~/.config/librecode/{skills,agents}/imported/<source>/`. Idempotent — " +
          "re-running an import refreshes the cache and overwrites the imported files.",
        operationId: "controlPanel.import.run",
        responses: { 200: { description: "OK" }, ...errors(400, 404) },
      }),
      validator("json", z.object({ id: z.string().min(1) })),
      async (c) => {
        const { id } = c.req.valid("json")
        const result = await Importer.run(id)
        if (!result.ok) {
          const status = result.step === "lookup" ? 404 : 400
          return c.json({ ok: false, error: result.error, step: result.step }, status)
        }
        return c.json(result, 200)
      },
    )
    .delete(
      "/import",
      describeRoute({
        summary: "Remove all imports from a source",
        description:
          "Wipes the source's cache + the imported skills/agents under `~/.config/librecode/{skills,agents}/imported/<source>/`. " +
          "Returns `removed: false` if the source was never imported.",
        operationId: "controlPanel.import.remove",
        responses: { 200: { description: "OK" }, ...errors(400) },
      }),
      validator("json", z.object({ id: z.string().min(1) })),
      async (c) => {
        const { id } = c.req.valid("json")
        const removed = await Importer.remove(id)
        return c.json({ ok: true, removed })
      },
    ),
)
