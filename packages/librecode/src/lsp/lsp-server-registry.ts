// Barrel that re-exports every language server definition.
// Only server instances (Info objects) are exported here — helpers like
// NearestRoot are intentionally omitted so Object.values(LSPServer) returns
// only server definitions.


// Scripting / data / misc language servers
export {
  BashLS,
  Clojure,
  Dart,
  DockerfileLS,
  Gleam,
  HLS,
  JDTLS,
  JuliaLS,
  KotlinLS,
  LuaLS,
  Nixd,
  Ocaml,
  PHPIntelephense,
  Prisma,
  Pyright,
  TerraformLS,
  TexLab,
  Tinymist,
  Ty,
  YamlLS,
} from "./servers/scripting"

// Compiled / systems-language servers
export { Clangd, CSharp, ElixirLS, FSharp, Gopls, Rubocop, RustAnalyzer, SourceKit, Zls } from "./servers/systems"
// Web / JS / TS servers
export { Astro, Biome, Deno, ESLint, Oxlint, Svelte, Typescript, Vue } from "./servers/web"
