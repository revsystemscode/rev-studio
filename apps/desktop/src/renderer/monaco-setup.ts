// Monaco se empaqueta con la app: ni el editor ni sus workers se descargan de ningún CDN.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

// El editor abre archivos sueltos, sin el resto del proyecto: los errores semánticos (imports
// "inexistentes", tipos de otros archivos) serían falsos. Se conservan los de sintaxis.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
}

loader.config({ monaco })

/** Lenguaje de Monaco para una ruta, por extensión o nombre de archivo. */
export function languageFor(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  const lang = monaco.languages
    .getLanguages()
    .find((l) => l.filenames?.includes(name) || (ext !== '' && l.extensions?.some((e) => e.toLowerCase() === ext)))
  return lang?.id ?? 'plaintext'
}

export { monaco }
