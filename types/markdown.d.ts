// Markdown imported as its text (next.config.mjs, asset/source).
declare module '*.md' {
  const text: string
  export default text
}
