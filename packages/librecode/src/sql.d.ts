declare module "*.sql" {
  const content: string
  export { content }
  export default content
}
