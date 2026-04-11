// Barrel that re-exports every language server definition.
// Only server instances (Info objects) are exported here — helpers like
// NearestRoot are intentionally omitted so Object.values(LSPServer) returns
// only server definitions.

// Web / JS / TS servers
export {
  Deno,
  Typescript,
  Vue,
  ESLint,
  Oxlint,
  Biome,
  Svelte,
  Astro,
} from "./servers/web"

// Compiled / systems-language servers
export {
  Gopls,
  Rubocop,
  ElixirLS,
  Zls,
  CSharp,
  FSharp,
  SourceKit,
  RustAnalyzer,
  Clangd,
} from "./servers/systems"

// Scripting / data / misc language servers
export {
  Ty,
  Pyright,
  JDTLS,
  KotlinLS,
  YamlLS,
  LuaLS,
  PHPIntelephense,
  Prisma,
  Dart,
  Ocaml,
  BashLS,
  TerraformLS,
  TexLab,
  DockerfileLS,
  Gleam,
  Clojure,
  Nixd,
  Tinymist,
  HLS,
  JuliaLS,
} from "./servers/scripting"
