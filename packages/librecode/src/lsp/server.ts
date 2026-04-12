// LSPServer — language server spawn registry.
//
// The original file was split into focused sub-modules to stay under 1 000 lines:
//   lsp/install.ts           — download/install helpers for each language server
//   lsp/servers/web.ts       — web/JS/TS/CSS language servers + shared types
//   lsp/servers/systems.ts   — compiled/systems language servers
//   lsp/servers/scripting.ts — scripting/data/misc language servers
//
// This file re-exports everything as the `LSPServer` object/namespace so that
// all existing consumers continue to work without changes.

import * as registry from "./lsp-server-registry"

export type { Handle, Info } from "./servers/web"
export { NearestRoot } from "./servers/web"

// The runtime `LSPServer` object — consumers iterate it with Object.values(LSPServer)
// and access individual servers via LSPServer.Typescript etc.
export const LSPServer = registry

// Type-only namespace augmentation so callers can use LSPServer.Info / LSPServer.Handle
// as types in function signatures.
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace LSPServer {
  export type Handle = import("./servers/web").Handle
  export type Info = import("./servers/web").Info
}
