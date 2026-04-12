declare module "*.sql" {
  const content: string
  export { content }
  // biome-ignore lint/style/noDefaultExport: ambient module declaration requires default export for import interop
  export default content
}
