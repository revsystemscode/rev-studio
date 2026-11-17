import { memo, useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from '@/lib/highlight'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

const textOf = (node: HastNode): string => (node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join(''))

function CodeBlock({ code, language }: { code: string; language: string | undefined }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    highlight(code, language).then(
      (result) => !stale && setHtml(result),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [code, language])

  return (
    <div className="code-block bg-muted/60 my-2 overflow-hidden rounded-md border">
      {language && <div className="text-muted-foreground border-b px-3 py-1 font-mono text-[11px]">{language}</div>}
      {html ? (
        // Shiki escapa el código: el HTML solo contiene sus propias etiquetas de color.
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

const components: Components = {
  pre({ node }) {
    const code = (node?.children?.[0] ?? null) as HastNode | null
    if (!code || code.tagName !== 'code') return <pre>{node ? textOf(node as HastNode) : null}</pre>
    const classes = Array.isArray(code.properties?.className) ? (code.properties.className as string[]) : []
    const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length)
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} language={language} />
  },
  a({ href, children }) {
    // La ventana nunca navega: los enlaces https se abren en el navegador del sistema.
    return (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault()
          if (href?.startsWith('https://')) void window.rev.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  img({ alt }) {
    return <span className="text-muted-foreground">[imagen{alt ? `: ${alt}` : ''}]</span>
  },
}

/** Markdown del agente. Sin HTML incrustado: react-markdown lo muestra como texto. */
export const Markdown = memo(function Markdown({ children }: { children: string }): ReactNode {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
