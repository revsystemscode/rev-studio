import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Cada lenguaje se carga la primera vez que aparece; nombres y alias habituales en Markdown.
const loaders: Record<string, () => Promise<{ default: LanguageInput }>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
}
const aliases: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  jsonc: 'json',
  htm: 'html',
}

let highlighter: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    // Motor de expresiones en JavaScript: sin WebAssembly, que la política de contenido no permite.
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}

export function resolveLanguage(name: string | undefined): string | null {
  if (!name) return null
  const key = name.toLowerCase()
  const lang = aliases[key] ?? key
  return lang in loaders ? lang : null
}

/** HTML resaltado con los colores claro y oscuro como variables CSS; null si el lenguaje no se conoce. */
export async function highlight(code: string, language: string | undefined): Promise<string | null> {
  const lang = resolveLanguage(language)
  if (!lang) return null
  const h = await getHighlighter()
  let ready = loaded.get(lang)
  if (!ready) {
    ready = loaders[lang]!().then((m) => h.loadLanguage(m.default))
    loaded.set(lang, ready)
  }
  await ready
  return h.codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false })
}
