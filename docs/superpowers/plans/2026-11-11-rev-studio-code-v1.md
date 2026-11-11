# Rev Studio v1 (modo Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App de escritorio (macOS arm64 y Windows x64) donde un agente con modelos abiertos lee, busca y edita archivos y ejecuta comandos en una carpeta de proyecto, con aprobaciones, instantáneas y panel de cambios.

**Architecture:** Monorepo pnpm con tres paquetes: `@rev/protocol` (esquemas Zod), `@rev/core` (agente, herramientas, proveedores, SQLite; sin Electron) y `@rev/desktop` (Electron + React). El core corre en un `utilityProcess` y habla con el renderer por `MessagePort` con mensajes validados.

**Tech Stack:** TypeScript, pnpm workspaces, Electron (≥ 35) con electron-vite y electron-builder, React, Tailwind, shadcn/ui, Zustand, Monaco, Zod 4, `node:sqlite`, Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`), `@vscode/ripgrep`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-rev-studio-code-v1-design.md`

## Global Constraints

- Node de desarrollo y CI ≥ 22.13 (por `node:sqlite`); Electron ≥ 35 (incluye Node ≥ 22.13). Instalar las últimas versiones estables de cada dependencia.
- `@rev/core` y `@rev/protocol` no importan `electron`. `@rev/protocol` no depende de los otros dos paquetes.
- Sin módulos nativos que requieran compilación (nada de `better-sqlite3` ni `node-pty`).
- Renderer con `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; sin acceso a disco ni red.
- Todo mensaje UI ↔ core se valida con Zod al recibirse, en ambos lados.
- Ningún archivo se modifica ni comando se ejecuta sin aprobación puntual o regla guardada.
- Interfaz en español. Textos fijos de botones: `Permitir`, `Siempre en este proyecto`, `Denegar`, `Detener`, `Reintentar`, `Revertir`.
- Constantes de la spec: 50 pasos por turno; 3 llamadas mal formadas seguidas; recorte a 400 líneas o 20 000 caracteres; `read_file` máximo 2 000 líneas y 100 000 caracteres; comandos 120 s por defecto y 600 s máximo; compactación al 80 % conservando 2 turnos; contexto Ollama 32 768 por defecto; aviso de ventana bajo 32 000 tokens.
- Todas las pruebas pasan en macOS y Windows. Las pruebas usan carpetas temporales (`fs.mkdtemp`) y comandos `node -e "…"` para ser portables.
- TDD: prueba que falla, implementación, prueba que pasa, commit. Mensajes de commit estilo `feat(core): …`, terminados con `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Trabajar en una rama `v1-code`, no en `main`.

## Review Focus

Condiciones que la spec implica y que deben quedar cubiertas por pruebas (cada una está asignada a su tarea):

1. **Archivos con finales de línea CRLF** (habituales en Windows): `edit_file` debe encontrar el texto aunque el modelo envíe `\n`, y conservar CRLF al escribir. → Tarea 3.
2. **Comando con salida enorme o infinita:** no debe agotar la memoria; la salida en memoria se limita a 1 MB (mitad inicial y mitad final). → Tarea 4.
3. **Rutas con espacios y caracteres no ASCII** (`C:\Users\José\Mis proyectos`): herramientas, ripgrep y comandos deben funcionar. → Tareas 3 y 4.
4. **Archivo binario o muy grande abierto desde la UI:** rechazo con mensaje claro, sin congelar la ventana (límite 2 MB). → Tarea 9.
5. **Carpetas gigantes** (`node_modules`): `find_files` y `search` respetan `.gitignore` y limitan resultados; el vigilante de archivos las ignora y agrupa eventos. → Tareas 3, 4 y 9.

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .github/workflows/{ci,release}.yml
packages/protocol/src/
  entities.ts      Tipos de dominio compartidos
  envelope.ts      Petición, respuesta, evento, códigos de error
  methods.ts       Tabla método → { params, result }
  events.ts        Unión discriminada de eventos del core
  index.ts
packages/core/src/
  db/open.ts, db/migrations.ts, db/repos/{projects,sessions,messages,snapshots,permissions,providers}.ts
  tools/types.ts, tools/jail.ts, tools/truncate.ts, tools/registry.ts
  tools/{list-dir,read-file,find-files,search,edit-file,write-file,run-command}.ts
  exec/spawn-tree.ts          Proceso hijo con límite de salida y muerte del árbol
  permissions/command-prefix.ts, permissions/service.ts
  snapshots/store.ts
  providers/types.ts, providers/{ollama,openai-compatible,fake}.ts, providers/probe.ts, providers/registry.ts
  agent/history.ts, agent/compaction.ts, agent/runner.ts
  host/start.ts, host/router.ts, host/session-manager.ts, host/fs-handlers.ts, host/watcher.ts
  index.ts
apps/desktop/
  electron.vite.config.ts, electron-builder.yml, playwright.config.ts
  src/main/{index,core-process,secrets,update-check}.ts
  src/core-entry.ts           Arranca @rev/core dentro del utilityProcess
  src/preload/index.ts
  src/renderer/{main.tsx,App.tsx}
  src/renderer/client.ts      Cliente del protocolo sobre MessagePort
  src/renderer/state/{app-store,session-state}.ts
  src/renderer/components/{Sidebar,Settings,FirstRun,Chat,ToolLine,ApprovalCard,Composer,ModelPicker,FilesPanel,FileTree,ChangesList,Editor}.tsx
  e2e/{fixtures.ts,smoke.spec.ts,code-flow.spec.ts}
docs/INSTALAR.md
```

---

### Task 1: Monorepo y paquete `protocol`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/protocol/{package.json,tsconfig.json}`, `packages/protocol/src/{entities,envelope,methods,events,index}.ts`
- Test: `packages/protocol/src/protocol.test.ts`

**Interfaces — Produces** (todo exportado desde `@rev/protocol` como esquema Zod `XSchema` y tipo `X`):

```ts
// entities.ts
Project      { id: string; name: string; path: string; available: boolean }
Session      { id: string; projectId: string; title: string; providerId: string; model: string;
               turnStatus: 'idle'|'running'|'interrupted'|'failed'; turnError: string|null;
               createdAt: number; updatedAt: number }
Part         = { type:'text'; text: string }
             | { type:'tool-call'; callId: string; name: string; input: unknown }
             | { type:'tool-result'; callId: string; output: string; isError: boolean }
StoredMessage{ id: string; sessionId: string; seq: number; role:'user'|'assistant'|'tool'|'summary';
               parts: Part[]; coversUpToSeq: number|null; createdAt: number }
ProviderType = 'ollama'|'lmstudio'|'openai-compatible'|'fake'
ProviderConfig { id: string; type: ProviderType; name: string; baseUrl: string;
                 hasKey: boolean; contextSize: number|null }
ProviderStatus { config: ProviderConfig; reachable: boolean }
Capabilities { tools: 'yes'|'no'|'unknown'; contextWindow: number|null }
ApprovalPreview = { kind:'diff'; path: string; original: string|null; proposed: string }
                | { kind:'command'; command: string; cwd: string }
ApprovalRequest { id: string; sessionId: string; callId: string; toolName: string; preview: ApprovalPreview }
ApprovalDecision = 'once'|'always'|'deny'
PermissionRule { id: string; projectId: string; toolName: string; pattern: string }
ChangedFile  { path: string; status: 'modified'|'created'|'deleted' }
DirEntry     { name: string; path: string; isDir: boolean }

// envelope.ts
ErrorCode = 'invalid_params'|'not_found'|'outside_root'|'too_large'|'binary'|'provider_unreachable'|'internal'
Request  { id: number; method: string; params: unknown }
Response { id: number; result: unknown } | { id: number; error: { code: ErrorCode; message: string } }
EventEnvelope { event: CoreEvent }

// methods.ts — export const methods: Record<MethodName, { params: ZodType; result: ZodType }>
'projects.list' {} → Project[]                'projects.add' {path} → Project
'projects.remove' {id} → {}                   'projects.relocate' {id, path} → Project
'sessions.list' {projectId} → Session[]       'sessions.create' {projectId, providerId, model} → Session
'sessions.delete' {id} → {}                   'sessions.setModel' {id, providerId, model} → Session
'sessions.get' {id} → { session: Session; messages: StoredMessage[]; pendingApprovals: ApprovalRequest[];
                        usedTokens: number; windowTokens: number|null }
'turn.send' {sessionId, text} → {}            'turn.stop' {sessionId} → {}       'turn.retry' {sessionId} → {}
'approval.resolve' {approvalId, decision: ApprovalDecision} → {}
'fs.list' {projectId, dir} → DirEntry[]       'fs.read' {projectId, path} → {content: string}
'fs.write' {projectId, path, content} → {}
'changes.list' {sessionId} → ChangedFile[]    'changes.diff' {sessionId, path} → {original: string|null; current: string|null}
'changes.revert' {sessionId, path} → {}
'providers.list' {} → ProviderStatus[]
'providers.save' {id?: string; type; name; baseUrl; keyCipher?: string|null; contextSize: number|null} → ProviderConfig
'providers.remove' {id} → {}                  'providers.models' {providerId} → string[]
'providers.capabilities' {providerId, model} → Capabilities
'permissions.list' {projectId} → PermissionRule[]   'permissions.remove' {id} → {}
'settings.get' {} → {defaultProviderId: string|null; defaultModel: string|null}
'settings.set' {defaultProviderId, defaultModel} → {}

// events.ts — CoreEvent, discriminado por `type`
{type:'message.added'; sessionId; message: StoredMessage}
{type:'text.delta'; sessionId; delta: string}
{type:'tool.started'; sessionId; callId; name; input: unknown}
{type:'tool.finished'; sessionId; callId; output: string; isError: boolean}
{type:'approval.requested'; sessionId; approval: ApprovalRequest}
{type:'approval.resolved'; sessionId; approvalId: string}
{type:'file.changed'; sessionId; path: string}
{type:'tree.changed'; projectId; dir: string}
{type:'context.usage'; sessionId; usedTokens: number; windowTokens: number|null}
{type:'turn.status'; sessionId; status: Session['turnStatus']; error: string|null}
```

Las rutas en `DirEntry.path`, `ChangedFile.path`, `fs.*` y `changes.*` son relativas a la raíz del proyecto, con `/` como separador en ambas plataformas.

- [ ] **Step 1: Crear el esqueleto del monorepo.** `package.json` raíz con scripts `test` (`pnpm -r test`), `typecheck` (`pnpm -r typecheck`); `pnpm-workspace.yaml` con `packages/*` y `apps/*`; `tsconfig.base.json` con `strict`, `module: NodeNext`, `target: ES2023`; `.gitignore` con `node_modules`, `dist`, `out`, `release`. Cada paquete: scripts `test` (`vitest run`) y `typecheck` (`tsc --noEmit`).
- [ ] **Step 2: Escribir la prueba que falla** en `packages/protocol/src/protocol.test.ts`:

```ts
it('acepta una petición válida de turn.send', () => {
  expect(methods['turn.send'].params.safeParse({ sessionId: 's1', text: 'hola' }).success).toBe(true)
})
it('rechaza turn.send sin texto', () => {
  expect(methods['turn.send'].params.safeParse({ sessionId: 's1' }).success).toBe(false)
})
it('rechaza un evento con tipo desconocido', () => {
  expect(CoreEventSchema.safeParse({ type: 'nope' }).success).toBe(false)
})
it('rechaza una decisión de aprobación inválida', () => {
  expect(methods['approval.resolve'].params.safeParse({ approvalId: 'a', decision: 'maybe' }).success).toBe(false)
})
it('toda entrada de methods tiene params y result', () => {
  for (const m of Object.values(methods)) { expect(m.params).toBeDefined(); expect(m.result).toBeDefined() }
})
```

- [ ] **Step 3: Ejecutar** `pnpm --filter @rev/protocol test` → FALLA (módulos inexistentes).
- [ ] **Step 4: Implementar** los cinco archivos de `src/` según el bloque Interfaces.
- [ ] **Step 5: Ejecutar** `pnpm test && pnpm typecheck` → PASA.
- [ ] **Step 6: Crear `.github/workflows/ci.yml`:** en `push` y `pull_request`, matriz `macos-latest` y `windows-latest`, Node 24, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`.
- [ ] **Step 7: Commit** `chore: scaffold monorepo and protocol package`.

---

### Task 2: Base de datos

**Files:**
- Create: `packages/core/{package.json,tsconfig.json}`, `packages/core/src/db/{open,migrations}.ts`, `packages/core/src/db/repos/{projects,sessions,messages,snapshots,permissions,providers}.ts`
- Test: `packages/core/src/db/db.test.ts`

**Interfaces**
- Consumes: tipos de `@rev/protocol`.
- Produces:

```ts
// open.ts
openDatabase(path: string, migrations?: string[]): DatabaseSync   // path ':memory:' en pruebas
class MigrationError extends Error { backupPath: string | null }
// repos — cada uno es una fábrica que recibe la DatabaseSync
projectsRepo(db):   { list(): ProjectRow[]; add(name, path): ProjectRow; get(id); remove(id); setPath(id, path) }
sessionsRepo(db):   { list(projectId); create(projectId, providerId, model): Session; get(id); remove(id);
                      setModel(id, providerId, model); setTitle(id, title);
                      setTurnStatus(id, status, error: string|null); interruptRunning(): void }
messagesRepo(db):   { list(sessionId): StoredMessage[]; append(sessionId, role, parts, coversUpToSeq?: number): StoredMessage }
snapshotsRepo(db):  { get(sessionId, path): {original: string|null} | undefined; put(sessionId, path, original: string|null);
                      list(sessionId): {path: string; original: string|null}[]; remove(sessionId, path) }
permissionsRepo(db):{ list(projectId): PermissionRule[]; add(projectId, toolName, pattern): PermissionRule; remove(id) }
providersRepo(db):  { list(): ProviderRow[]; get(id); save(row: ProviderRow): ProviderRow; remove(id);
                      getSetting(key): string|null; setSetting(key, value: string|null) }
ProviderRow = { id; type: ProviderType; name; baseUrl; keyCipher: string|null; contextSize: number|null }
ProjectRow  = { id; name; path }
```

Esquema (migración 1, en `migrations.ts` como primer elemento de `export const migrations: string[]`):

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE);
CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL,
  turn_status TEXT NOT NULL DEFAULT 'idle', turn_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, role TEXT NOT NULL, parts TEXT NOT NULL, covers_upto_seq INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq));
CREATE TABLE file_snapshots (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL, existed INTEGER NOT NULL, original TEXT, PRIMARY KEY(session_id, path));
CREATE TABLE permissions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL, pattern TEXT NOT NULL, UNIQUE(project_id, tool_name, pattern));
CREATE TABLE providers (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT NOT NULL,
  key_cipher TEXT, context_size INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

`openDatabase` activa `PRAGMA foreign_keys = ON` y `journal_mode = WAL`, lee `PRAGMA user_version`, y si hay migraciones pendientes copia antes el archivo a `<path>.bak-v<versión>` (no aplica a `:memory:` ni a archivo nuevo), aplica cada una en una transacción y actualiza `user_version`. Si una falla, hace rollback y lanza `MigrationError`. Los ids son `crypto.randomUUID()`.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
it('aplica las migraciones y deja user_version = migrations.length')
it('messages.append asigna seq consecutivo desde 1 por sesión y round-trip de parts JSON')
it('borrar un proyecto borra en cascada sesiones, mensajes, snapshots y permisos')
it('snapshots.put con original null se lee como { original: null } (archivo que no existía)')
it('permissions.add repetido con mismo (proyecto, tool, pattern) no duplica')
it('sessions.interruptRunning pasa a interrupted solo las sesiones en running')
it('una migración inválida lanza MigrationError, conserva user_version y deja copia .bak', () => {
  // archivo temporal con migración 1 aplicada; reabrir con [...migrations, 'CREATE TABLE (;']
})
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- db` → FALLA.
- [ ] **Step 3: Implementar** `open.ts`, `migrations.ts` y los seis repos.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat(core): sqlite database with migrations and repositories`.

---

### Task 3: Jaula de carpeta y herramientas de archivos

**Files:**
- Create: `packages/core/src/tools/{types,jail,truncate,list-dir,read-file,find-files,edit-file,write-file}.ts`, `packages/core/src/snapshots/store.ts`
- Test: `packages/core/src/tools/{jail,file-tools,truncate}.test.ts`, `packages/core/src/snapshots/store.test.ts`

**Interfaces**
- Consumes: `snapshotsRepo` (Tarea 2); `ApprovalPreview`, `ChangedFile`.
- Produces:

```ts
// types.ts
interface ToolContext { root: string; sessionId: string; signal: AbortSignal; rgPath: string;
                        snapshots: SnapshotStore; onFileChanged(relPath: string): void }
interface ToolDef<I = any> { name: string; description: string; schema: z.ZodType<I>;
  kind: 'read' | 'edit' | 'command'; truncateOutput: boolean;
  preview?(input: I, ctx: ToolContext): Promise<ApprovalPreview>;
  run(input: I, ctx: ToolContext): Promise<string> }
class ToolError extends Error {}          // su message es lo que recibe el modelo
// jail.ts
class OutsideRootError extends ToolError {}
resolveInRoot(root: string, p: string): Promise<string>   // ruta absoluta real; lanza OutsideRootError
toRel(root: string, abs: string): string                  // relativa con '/'
// truncate.ts
truncateOutput(text: string, maxLines = 400, maxChars = 20_000): string
// snapshots/store.ts
class SnapshotStore { constructor(repo, root: string, sessionId: string)
  captureBeforeWrite(absPath: string): Promise<void>      // solo la primera vez por ruta
  list(): Promise<ChangedFile[]>                           // omite los que hoy son idénticos al original
  diff(relPath: string): Promise<{ original: string|null; current: string|null }>
  revert(relPath: string): Promise<void> }
// herramientas: export const listDir, readFile, findFiles, editFile, writeFile: ToolDef
```

Esquemas de entrada: `list_dir {path}`; `read_file {path, startLine?, endLine?}` (1-indexadas, inclusivas); `find_files {pattern}`; `edit_file {path, oldText, newText}`; `write_file {path, content}`.

Decisiones:
- `resolveInRoot`: resolver `p` contra `root`; calcular `realpath` del ancestro existente más profundo y volver a unir el resto; comparar con `realpath(root)` usando `path.relative` (fuera si empieza por `..` o es absoluta). Nunca usar `startsWith`.
- `read_file`: salida con número de línea por línea (`  12\t…`). Rechaza como binario si hay byte NUL en los primeros 8 KB. Corta a 2 000 líneas o 100 000 caracteres e indica el rango devuelto y el total. `truncateOutput: false`.
- `find_files`: ejecuta `rg --files -g <pattern>` en `root` (respeta `.gitignore`), máximo 500 resultados e indica si hubo más.
- `edit_file`: normaliza `\r\n` → `\n` en `oldText`/`newText`; si el archivo usa CRLF, los convierte a `\r\n` antes de buscar. Falla con `ToolError` si hay 0 coincidencias o más de 1 (el mensaje dice cuántas). `preview` devuelve el diff sin escribir.
- `write_file`: crea carpetas intermedias. `preview` con `original: null` si no existe.
- `edit_file` y `write_file` llaman a `ctx.snapshots.captureBeforeWrite` antes de escribir y a `ctx.onFileChanged` después.
- `truncateOutput`: si excede, conserva la primera mitad y la última mitad del presupuesto y pone en medio `[… N líneas omitidas …]`.
- `SnapshotStore.revert`: restaura el contenido, o borra el archivo si no existía; después elimina la instantánea.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// jail.test.ts
it('acepta "src/a.ts" y devuelve ruta absoluta dentro de root')
it('rechaza "../fuera.txt" con OutsideRootError')
it('rechaza una ruta absoluta fuera de root')
it('rechaza un symlink dentro de root que apunta fuera')            // it.skipIf si symlink da EPERM
it('rechaza un archivo nuevo dentro de una carpeta-symlink que apunta fuera')
it('acepta un archivo nuevo en carpeta aún inexistente dentro de root')
it('funciona con root "Mis proyectos/José" (espacios y no ASCII)')
it('en win32 rechaza otra unidad ("D:\\x") y trata C:\\Root y c:\\root como la misma', { skip: process.platform !== 'win32' })
// file-tools.test.ts
it('read_file numera líneas y respeta startLine/endLine')
it('read_file de 3000 líneas devuelve 2000 e indica "líneas 1-2000 de 3000"')
it('read_file rechaza un archivo con bytes NUL')
it('find_files respeta .gitignore y no lista node_modules ignorado')
it('find_files limita a 500 resultados e indica que hay más')
it('edit_file reemplaza una coincidencia única')
it('edit_file falla sin tocar el archivo con 0 coincidencias y con 2')
it('edit_file en archivo CRLF con oldText en \\n coincide y el resultado conserva solo CRLF')
it('write_file crea carpetas intermedias; preview.original es null si no existía')
it('edit_file y write_file capturan snapshot antes de escribir y llaman a onFileChanged')
it('toda herramienta de archivos rechaza rutas fuera de root')       // it.each sobre las cinco
// store.test.ts
it('captureBeforeWrite dos veces conserva el primer original')
it('list devuelve modified / created / deleted según el estado en disco, y omite archivos idénticos al original')
it('revert restaura el contenido; revert de un archivo creado lo borra; ambos eliminan la instantánea')
// truncate.test.ts
it('no toca textos dentro de límites')
it('1000 líneas → 400 líneas conservadas (200 + 200) y marcador con 600 omitidas')
it('una sola línea de 50 000 caracteres queda en ≤ 20 000 más el marcador')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- tools snapshots` → FALLA.
- [ ] **Step 3: Implementar** los archivos listados. Añadir `@vscode/ripgrep` como dependencia de `@rev/core` solo para pruebas (devDependency); en producción `rgPath` llega inyectado.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat(core): folder jail, file tools and snapshots`.

---

### Task 4: Búsqueda y ejecución de comandos

**Files:**
- Create: `packages/core/src/exec/spawn-tree.ts`, `packages/core/src/tools/{search,run-command,registry}.ts`
- Test: `packages/core/src/exec/spawn-tree.test.ts`, `packages/core/src/tools/{search,run-command}.test.ts`

**Interfaces**
- Consumes: `ToolDef`, `ToolContext`, `ToolError` (Tarea 3).
- Produces:

```ts
// spawn-tree.ts
interface RunResult { exitCode: number | null; output: string; timedOut: boolean; aborted: boolean; truncatedBytes: number }
runProcess(opts: { file: string; args: string[]; cwd: string; timeoutMs: number;
                   signal: AbortSignal; maxBytes?: number /* 1_048_576 */ }): Promise<RunResult>
shellInvocation(command: string, platform?: NodeJS.Platform): { file: string; args: string[] }
// tools
export const search: ToolDef       // { query: string; glob?: string; caseSensitive?: boolean }
export const runCommand: ToolDef   // { command: string; timeoutSeconds?: number }
// registry.ts
export const allTools: ToolDef[]   // las siete
toolSpecs(): { name: string; description: string; parameters: object }[]   // JSON Schema vía z.toJSONSchema
getTool(name: string): ToolDef | undefined
```

Decisiones:
- `shellInvocation`: darwin → `/bin/zsh`, `['-lc', command]`; win32 → `powershell.exe`, `['-NoProfile','-NonInteractive','-Command', command]`.
- `runProcess`: `stdio: ['ignore','pipe','pipe']`, stdout y stderr combinados en orden de llegada. En darwin `detached: true` y se mata con `process.kill(-pid, 'SIGKILL')`; en win32 `taskkill /pid <pid> /T /F`. Al superar `maxBytes` conserva los primeros `maxBytes/2` y un búfer circular con los últimos `maxBytes/2`.
- `run_command`: `timeoutSeconds` por defecto 120, máximo 600 (valores mayores se limitan). Salida al modelo: la salida más una línea final `[código de salida: N]`, `[tiempo agotado tras N s]` o `[cancelado]`. `preview` → `{ kind:'command', command, cwd: root }`. `kind: 'command'`.
- `search`: `rg --line-number --no-heading --color never --max-count 50 --max-columns 300` en `root`; `-i` salvo `caseSensitive`; `-g glob` si se da. Código de salida 1 de rg significa "sin resultados", no error.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// spawn-tree.test.ts  (comandos vía shellInvocation('node -e "…"'))
it('captura stdout y stderr y el código de salida')
it('agota el tiempo: timedOut true y resuelve en < timeout + 3 s')
it('abortar mata el proceso: aborted true')
it('mata también a los nietos', async () => {
  // el hijo lanza un nieto que escribe su pid y duerme 60 s; tras abortar, process.kill(pidNieto, 0) lanza ESRCH
})
it('salida infinita con timeout 2 s: output ≤ 1 MB + marcador y truncatedBytes > 0')
it('funciona con cwd "Mis proyectos/José"')
it('shellInvocation devuelve zsh -lc en darwin y powershell -NoProfile en win32')
// search.test.ts
it('encuentra coincidencias con ruta:línea:texto')
it('sin coincidencias devuelve "Sin resultados", no error')
it('respeta .gitignore')
it('funciona con root con espacios y no ASCII')
// run-command.test.ts
it('devuelve salida y "[código de salida: 0]"')
it('un código distinto de 0 no lanza; se informa en la salida')
it('timeoutSeconds 9999 se limita a 600')
it('preview devuelve el comando completo y cwd = root')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- exec search run-command` → FALLA.
- [ ] **Step 3: Implementar** `spawn-tree.ts`, `search.ts`, `run-command.ts`, `registry.ts`.
- [ ] **Step 4: Ejecutar** → PASA en la plataforma local; confirmar en CI que pasa en la otra.
- [ ] **Step 5: Commit** `feat(core): search and command execution tools`.

---

### Task 5: Permisos

**Files:**
- Create: `packages/core/src/permissions/{command-prefix,service}.ts`
- Test: `packages/core/src/permissions/permissions.test.ts`

**Interfaces**
- Consumes: `permissionsRepo` (Tarea 2), `ToolDef` (Tarea 3).
- Produces:

```ts
isChained(command: string): boolean
commandPrefix(command: string): string | null      // null si está encadenado o vacío
class PermissionService { constructor(repo)
  check(projectId: string, tool: ToolDef, input: unknown): 'allow' | 'ask'
  remember(projectId: string, tool: ToolDef, input: unknown): void }
```

Decisiones:
- `isChained`: verdadero si el comando contiene `&`, `|`, `;`, `<`, `>`, `` ` ``, `$(` o salto de línea.
- `commandPrefix`: las dos primeras palabras separadas por espacios (una si solo hay una).
- `check`: `kind 'read'` → `allow`. `kind 'edit'` → `allow` si existe regla `(toolName, '*')`. `kind 'command'` → `ask` si está encadenado; si no, `allow` cuando las palabras del comando empiezan exactamente por las palabras de alguna regla guardada.
- `remember`: edición → patrón `'*'`; comando → su prefijo; si el comando está encadenado no guarda nada.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
it.each(['a && b', 'a || b', 'a; b', 'a | b', 'a > f', 'a < f', 'a `b`', 'a $(b)', 'a\nb', 'a & b'])('isChained(%s)', c => expect(isChained(c)).toBe(true))
it('commandPrefix("npm test -- --watch") === "npm test"; ("ls") === "ls"; ("a && b") === null')
it('las herramientas de lectura siempre se permiten')
it('edit_file pregunta hasta remember; después se permite, y write_file sigue preguntando')
it('tras remember de "npm test", "npm test -- x" se permite')
it('"npm testx" y "npm run build" siguen preguntando')
it('"npm test && rm -rf ." pregunta aunque exista la regla "npm test"')
it('remember de un comando encadenado no crea regla')
it('las reglas de un proyecto no aplican a otro')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- permissions` → FALLA.
- [ ] **Step 3: Implementar** ambos archivos.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat(core): permission rules`.

---

### Task 6: Proveedores de modelos

**Files:**
- Create: `packages/core/src/providers/{types,ollama,openai-compatible,fake,probe,registry}.ts`
- Test: `packages/core/src/providers/{ollama,openai-compatible,probe,registry}.test.ts`

**Interfaces**
- Consumes: `Part`, `Capabilities`, `ProviderRow`.
- Produces:

```ts
// types.ts
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; parts: Part[] }
type ToolSpec = { name: string; description: string; parameters: object }
type StepEvent = { type: 'text'; delta: string }
               | { type: 'tool-call'; callId: string; name: string; input: unknown }
               | { type: 'finish'; inputTokens: number | null; outputTokens: number | null }
interface ModelClient { streamStep(req: { messages: ChatMessage[]; tools: ToolSpec[]; signal: AbortSignal }): AsyncIterable<StepEvent> }
class ProviderUnreachableError extends Error {}
interface Provider { listModels(): Promise<string[]>; getCapabilities(model: string): Promise<Capabilities>;
                     createModel(model: string): ModelClient; ping(): Promise<boolean> }
// registry.ts
createProvider(row: ProviderRow, apiKey: string | null, fetchImpl?: typeof fetch): Provider
DEFAULT_URLS = { ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234/v1' }
// probe.ts
probeTools(client: ModelClient): Promise<'yes' | 'no'>
// fake.ts
class FakeModelClient implements ModelClient { constructor(script: StepEvent[][]); requests: ChatMessage[][] }
loadFakeScript(path: string): StepEvent[][]
```

Decisiones:
- **Ollama** (con `fetch`, sin SDK): `GET /api/tags` para listar; `POST /api/show {model}` para capacidades (`capabilities` incluye `"tools"` → `yes`, si no `no`; ventana = el valor de `model_info` cuya clave termina en `.context_length`). `POST /api/chat` con `stream: true`, `tools` en formato `{type:'function', function:{name, description, parameters}}` y `options.num_ctx = min(row.contextSize ?? 32768, ventana del modelo)`. Respuesta NDJSON: `message.content` → evento `text`; `message.tool_calls[].function.{name, arguments}` → `tool-call` con `callId` generado; la línea con `done: true` → `finish` con `prompt_eval_count` / `eval_count`. Mensajes de rol `tool` se envían con `tool_name`.
- **LM Studio y OpenAI-compatible**: `createOpenAICompatible` + `streamText` de un solo paso, con herramientas sin `execute`; mapear su `fullStream` a `StepEvent`. Si el SDK entrega una llamada con argumentos JSON inválidos, emitir `tool-call` con `input` igual al texto crudo (la validación la hace el agente). Listar con `GET {baseUrl}/models`. Capacidades: LM Studio intenta `GET {origen}/api/v0/models` y usa `max_context_length` si está; en cualquier otro caso `contextWindow = row.contextSize` y `tools: 'unknown'`.
- **fake**: cada llamada a `streamStep` emite el siguiente elemento del guion; si se agota, emite `text` "fin" y `finish`. Capacidades `{tools:'yes', contextWindow: 32768}`.
- Fallo de conexión (`fetch` rechaza o `ECONNREFUSED`) → `ProviderUnreachableError`.
- `probeTools`: envía un mensaje de usuario "Call the ping tool." con una herramienta `ping` sin parámetros. `yes` si llega un `tool-call`; `no` si responde solo texto o el proveedor devuelve error HTTP 4xx.
- **Verificar con servidores reales** los nombres de campo de Ollama y LM Studio al implementar (paso 5); si difieren, manda la respuesta real y se ajustan los fixtures.

- [ ] **Step 1: Escribir las pruebas que fallan** (con `fetchImpl` simulado que devuelve fixtures):

```ts
// ollama.test.ts
it('listModels devuelve los nombres de /api/tags')
it('capabilities: tools yes y contextWindow leído de *.context_length')
it('capabilities: tools no cuando falta "tools"')
it('streamStep convierte NDJSON en text, tool-call y finish con tokens')
it('envía options.num_ctx = 32768 por defecto, y el valor del modelo si es menor')
it('envía los resultados de herramienta como rol tool con tool_name')
it('fetch rechazado → ProviderUnreachableError')
it('abortar la señal termina el iterador sin eventos posteriores')
// openai-compatible.test.ts  (SSE simulado de /chat/completions)
it('streamStep emite text, tool-call con input parseado y finish')
it('argumentos JSON inválidos → tool-call con input string crudo')
it('envía Authorization: Bearer <clave> cuando hay apiKey')
// probe.test.ts
it('yes si el modelo llama a ping; no si responde texto; no si hay error 400')
// registry.test.ts
it('createProvider elige la implementación por row.type')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- providers` → FALLA.
- [ ] **Step 3: Implementar** los seis archivos.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Verificación manual** con Ollama en marcha y un modelo con tools: script temporal que llama a `listModels`, `getCapabilities` y un `streamStep` con una herramienta; confirmar que llega un `tool-call`. Repetir con LM Studio si está instalado. Anotar el resultado en el mensaje de commit.
- [ ] **Step 6: Commit** `feat(core): model providers (ollama, openai-compatible, fake)`.

---

### Task 7: Bucle del agente

**Files:**
- Create: `packages/core/src/agent/{history,runner}.ts`
- Test: `packages/core/src/agent/runner.test.ts`

**Interfaces**
- Consumes: `ModelClient`, `FakeModelClient`, `ToolSpec` (T6); `getTool`, `toolSpecs`, `truncateOutput`, `ToolContext`, `SnapshotStore` (T3–T4); `PermissionService` (T5); `messagesRepo`, `sessionsRepo` (T2); `CoreEvent`, `ApprovalRequest`, `ApprovalDecision`.
- Produces:

```ts
// history.ts
SYSTEM_PROMPT: string
buildModelMessages(stored: StoredMessage[], root: string): ChatMessage[]
// runner.ts
MAX_STEPS = 50; MAX_MALFORMED = 3
interface RunnerDeps { sessionId: string; projectId: string; root: string; rgPath: string;
  model: ModelClient; contextWindow: number | null;
  messages: ReturnType<typeof messagesRepo>; sessions: ReturnType<typeof sessionsRepo>;
  permissions: PermissionService; snapshots: SnapshotStore; emit(e: CoreEvent): void;
  beforeStep?(): Promise<void> }                    // gancho para la compactación (Tarea 8)
class SessionRunner { constructor(deps: RunnerDeps)
  readonly running: boolean; usedTokens: number
  send(text: string): Promise<void>                 // resuelve al terminar el turno; nunca rechaza
  retry(): Promise<void>
  stop(): void
  pendingApprovals(): ApprovalRequest[]
  resolveApproval(approvalId: string, decision: ApprovalDecision): void }
```

Comportamiento:
- `send`: guarda el mensaje de usuario, emite `message.added`, pone `turn.status running` y ejecuta el bucle. `retry` ejecuta el bucle sin añadir mensaje. Llamar a `send`/`retry` con un turno en curso lanza error síncrono.
- Si la sesión aún tiene el título por defecto `"Nueva sesión"`, el primer `send` lo fija a los primeros 60 caracteres del texto.
- Cada paso: `await beforeStep?.()`; `buildModelMessages`; `model.streamStep`. Emite `text.delta` por fragmento. Al `finish`: guarda un mensaje `assistant` con el texto y las `tool-call`, actualiza `usedTokens` (si `inputTokens` es null, estima `caracteres / 4`) y emite `context.usage`.
- Sin llamadas a herramientas → turno terminado: `turn.status idle`.
- Por cada llamada, en orden y de una en una: herramienta desconocida o `schema.safeParse` fallido → resultado de error con el motivo, cuenta como mal formada. Tres pasos seguidos con alguna mal formada → `turn.status failed` con error `"El modelo no consigue llamar a las herramientas correctamente. Prueba con otro modelo."`. Un paso sin mal formadas reinicia la cuenta.
- Permiso: `permissions.check`; si es `ask`, crea `ApprovalRequest` con `tool.preview`, emite `approval.requested` y espera. `deny` → resultado de error `"El usuario rechazó esta acción."`. `always` → `permissions.remember` y ejecutar. Tras resolver emite `approval.resolved`.
- Ejecución: emite `tool.started`; `tool.run`; un `ToolError` u otra excepción se convierte en resultado de error (el turno sigue); aplica `truncateOutput` si `tool.truncateOutput`; emite `tool.finished`. Los resultados del paso se guardan en un único mensaje `tool`.
- Paso 50 que aún pide herramientas → `turn.status idle` tras guardar un mensaje `assistant` con el texto `"Se alcanzó el límite de 50 pasos. Escribe para continuar."`.
- `stop`: aborta la señal (cancela modelo y comando), rechaza las aprobaciones pendientes, guarda lo generado hasta el momento y deja `turn.status interrupted`.
- `ProviderUnreachableError` u otro error del modelo → `turn.status failed` con el mensaje del error.
- `buildModelMessages`: mensaje `system` (`SYSTEM_PROMPT` + la ruta raíz y la plataforma); si hay mensajes `summary`, toma el último y solo los mensajes con `seq > coversUpToSeq`, anteponiendo el resumen como mensaje `user`. Si el historial termina con `tool-call` sin su `tool-result` (turno interrumpido), añade resultados de error `"Interrumpido."` para mantener la secuencia válida.
- `SYSTEM_PROMPT` (en inglés, para los modelos): identifica al agente como asistente de programación que trabaja dentro de la carpeta del proyecto; indica leer antes de editar, usar `search`/`find_files` para localizar código, preferir `edit_file` a `write_file` en archivos existentes, que ediciones y comandos pueden requerir aprobación y que un rechazo no debe reintentarse igual; y responder en el idioma del usuario.

- [ ] **Step 1: Escribir las pruebas que fallan** (`FakeModelClient`, base `:memory:`, carpeta temporal, eventos recogidos en un array):

```ts
it('respuesta de solo texto: guarda user y assistant, emite text.delta y termina en idle')
it('llamada a read_file: se ejecuta sin aprobación y el segundo request al modelo incluye el tool-result')
it('edit_file emite approval.requested con preview diff y espera; "once" aplica la edición')
it('"deny" no toca el archivo y el modelo recibe "El usuario rechazó esta acción."')
it('"always" guarda la regla y la siguiente edit_file no pide aprobación')
it('herramienta que lanza ToolError → tool-result isError y el turno continúa')
it('herramienta desconocida y argumentos inválidos → tool-result de error con el motivo')
it('tres pasos seguidos con llamadas mal formadas → failed con el mensaje de cambio de modelo')
it('un paso válido entre medias reinicia la cuenta de mal formadas')
it('guion de 60 pasos con herramientas: se hacen exactamente 50 llamadas al modelo y termina en idle con el aviso')
it('stop durante una aprobación pendiente → interrupted, sin aprobaciones pendientes')
it('stop durante run_command mata el proceso y deja interrupted')
it('la salida de run_command de 1000 líneas llega recortada al modelo; la de read_file no')
it('ProviderUnreachableError → failed con el mensaje; retry posterior completa el turno')
it('retry tras interrupción añade tool-results "Interrumpido." a las llamadas huérfanas')
it('el primer mensaje fija el título de la sesión (60 caracteres máximo)')
it('send con turno en curso lanza')
it('emite context.usage con inputTokens del finish; sin tokens, estima caracteres/4')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- runner` → FALLA.
- [ ] **Step 3: Implementar** `history.ts` y `runner.ts`.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat(core): agent loop with approvals`.

---

### Task 8: Compactación de contexto

**Files:**
- Create: `packages/core/src/agent/compaction.ts`
- Test: `packages/core/src/agent/compaction.test.ts`

**Interfaces**
- Consumes: `ModelClient`, `messagesRepo`, `buildModelMessages`, `StoredMessage`.
- Produces:

```ts
COMPACT_THRESHOLD = 0.8; KEEP_TURNS = 2
shouldCompact(usedTokens: number, contextWindow: number | null): boolean
compact(deps: { sessionId: string; root: string; model: ModelClient;
                messages: ReturnType<typeof messagesRepo>; signal: AbortSignal }): Promise<boolean>
```

Decisiones:
- Un turno empieza en cada mensaje `user`. Se conservan los últimos `KEEP_TURNS` turnos; el corte es el `seq` anterior al primer mensaje del penúltimo turno. Con menos de 3 turnos vigentes no hay nada que compactar → `false`.
- Pide al modelo, sin herramientas, un resumen de los mensajes vigentes hasta el corte (incluido un resumen previo si existe), con instrucción de conservar objetivo, decisiones, archivos tocados y trabajo pendiente. Guarda el resultado como mensaje `summary` con `coversUpToSeq = corte`.
- `contextWindow` null → `shouldCompact` es `false`.
- Si la llamada de resumen falla, `compact` devuelve `false` sin guardar nada y el turno continúa.
- El `SessionRunner` se conecta mediante `beforeStep`: `if (shouldCompact(runner.usedTokens, window)) await compact(…)`. Ese cableado se hace en la Tarea 9.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
it('shouldCompact: 0.81 de la ventana → true; 0.79 → false; ventana null → false')
it('con 5 turnos: guarda un summary con coversUpToSeq = seq anterior al turno 4')
it('tras compactar, buildModelMessages devuelve system + resumen + turnos 4 y 5 íntegros')
it('los mensajes originales siguen en messages.list')
it('con 2 turnos no compacta y devuelve false')
it('una segunda compactación incluye el resumen previo en la petición y avanza coversUpToSeq')
it('si el modelo falla al resumir devuelve false y no guarda nada')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- compaction` → FALLA.
- [ ] **Step 3: Implementar** `compaction.ts`.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat(core): context compaction`.

---

### Task 9: Host del core (router, sesiones, archivos, vigilante)

**Files:**
- Create: `packages/core/src/host/{start,router,session-manager,fs-handlers,watcher}.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/host/host.test.ts`

**Interfaces**
- Consumes: todo lo anterior.
- Produces:

```ts
// start.ts
interface Transport { post(msg: unknown): void; onMessage(cb: (msg: unknown) => void): void }
interface CoreOptions { dbPath: string; rgPath: string; transport: Transport;
  decrypt(cipher: string): Promise<string>;
  fake?: { scriptPath: string } }                   // habilita el proveedor 'fake'
startCore(opts: CoreOptions): Promise<{ dispose(): Promise<void> }>
// index.ts reexporta startCore, CoreOptions, Transport
```

Decisiones:
- **Router:** valida el sobre con `RequestSchema`, busca el método en `methods`, valida `params` (`invalid_params` si falla), ejecuta el manejador, valida `result` y responde. Excepciones → `error` con el código: `OutsideRootError` → `outside_root`; `ProviderUnreachableError` → `provider_unreachable`; `ENOENT` → `not_found`; resto → `internal`. Todo evento emitido se envía como `{ event }`.
- **Arranque:** `openDatabase`; `sessions.interruptRunning()`; si no hay proveedores, crea filas `ollama` y `lmstudio` con `DEFAULT_URLS` (y `fake` si `opts.fake`).
- **SessionManager:** un `SessionRunner` por sesión, creado al primer uso con el proveedor y modelo de la sesión, y la clave obtenida con `decrypt(keyCipher)`. `sessions.setModel` descarta el runner si no está en marcha. `beforeStep` conecta la compactación. Cuando un runner emite `file.changed`, se reenvía.
- `sessions.create` usa el título `"Nueva sesión"`.
- `sessions.get` devuelve mensajes, aprobaciones pendientes del runner (o `[]`), `usedTokens` y `windowTokens`.
- `projects.add`: nombre = último segmento de la ruta; si la ruta ya existe devuelve el proyecto existente. `Project.available` = la carpeta existe.
- `providers.list` hace `ping()` a cada uno en paralelo con 1,5 s de límite. `providers.capabilities` devuelve `getCapabilities` y, si `tools` es `unknown`, ejecuta `probeTools`; guarda el resultado en memoria por `(providerId, model)`.
- **fs-handlers:** `fs.list` (ordenado: carpetas primero, alfabético; oculta `.git`), `fs.read`, `fs.write`; todos pasan por `resolveInRoot`. `fs.read` responde `too_large` si el archivo supera 2 MB y `binary` si hay NUL en los primeros 8 KB. Los cambios hechos con `fs.write` no crean instantánea.
- **changes.\***: delegan en el `SnapshotStore` de la sesión.
- **watcher:** `fs.watch(root, { recursive: true })` por proyecto, iniciado en el primer `fs.list` y cerrado en `projects.remove` y `dispose`. Ignora rutas bajo `.git/` y `node_modules/`. Agrupa por carpeta padre con 200 ms de espera y emite `tree.changed`. Un error del watcher (carpeta borrada) lo cierra sin tumbar el core.
- `dispose`: detiene todos los runners, cierra watchers y la base de datos.

- [ ] **Step 1: Escribir las pruebas que fallan** (transporte en memoria con ayudantes `call(method, params)` y `events[]`; proveedor `fake`; `decrypt` identidad):

```ts
it('método desconocido → error not_found; params inválidos → invalid_params')
it('projects.add + sessions.create + turn.send con guion de edición: llega approval.requested; approval.resolve "once" modifica el archivo y llega turn.status idle')
it('changes.list devuelve el archivo; changes.diff trae original y current; changes.revert lo restaura y la lista queda vacía')
it('sessions.get tras el turno devuelve los mensajes y, con aprobación pendiente, la incluye')
it('fs.read fuera de la raíz → outside_root')
it('fs.read de un archivo de 3 MB → too_large; de uno con bytes NUL → binary')
it('fs.list pone carpetas primero y oculta .git')
it('crear un archivo en disco emite tree.changed para su carpeta en < 2 s; 100 archivos en node_modules no emiten nada')
it('100 archivos creados seguidos en la misma carpeta emiten como mucho 3 tree.changed')
it('una sesión en running en la base pasa a interrupted al llamar a startCore')
it('dos sesiones ejecutan turnos a la vez sin mezclar eventos (sessionId correcto en cada uno)')
it('projects.list marca available false si la carpeta se borró; projects.relocate la corrige')
it('providers.capabilities con tools unknown ejecuta el sondeo y cachea el resultado')
it('providers.save con keyCipher llama a decrypt al crear el runner y nunca devuelve la clave (solo hasKey true)')
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/core test -- host` → FALLA.
- [ ] **Step 3: Implementar** los cinco archivos de `host/` e `index.ts`.
- [ ] **Step 4: Ejecutar** `pnpm test && pnpm typecheck` → PASA.
- [ ] **Step 5: Commit** `feat(core): host router, session manager and file watcher`.

---

### Task 10: Shell de Electron

**Files:**
- Create: `apps/desktop/{package.json,tsconfig.json,electron.vite.config.ts,playwright.config.ts,index.html}`
- Create: `apps/desktop/src/main/{index,core-process,secrets}.ts`, `apps/desktop/src/core-entry.ts`, `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/{main.tsx,App.tsx,client.ts}`
- Test: `apps/desktop/src/renderer/client.test.ts`, `apps/desktop/e2e/{fixtures.ts,smoke.spec.ts}`

**Interfaces**
- Consumes: `startCore`, `Transport` (T9); `methods`, sobres y `CoreEvent` de `@rev/protocol`.
- Produces:

```ts
// preload → window.rev
interface RevBridge { onCorePort(cb: (port: MessagePort) => void): void    // se llama de nuevo tras reiniciar el core
  pickFolder(): Promise<string | null>
  encryptSecret(plain: string): Promise<string>                            // base64
  openExternal(url: string): Promise<void>
  getAppInfo(): Promise<{ version: string; platform: string }> }
// renderer/client.ts
class CoreClient { constructor(port: MessagePort)
  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>
  onEvent(cb: (e: CoreEvent) => void): () => void
  close(): void }                                   // rechaza las llamadas pendientes
class CoreCallError extends Error { code: ErrorCode }
// e2e/fixtures.ts
launchApp(opts?: { script?: StepEvent[][] }): Promise<{ app: ElectronApplication; page: Page; projectDir: string; cleanup(): Promise<void> }>
```

Decisiones:
- `electron-vite` con cuatro entradas: `main`, `core-entry` (salida junto a main), `preload`, `renderer`.
- `core-process.ts`: `utilityProcess.fork(core-entry)`; crea `MessageChannelMain`, envía un puerto al core (`postMessage({type:'port'}, [port1])`) y el otro al renderer (`webContents.postMessage('core-port', null, [port2])`). Al salir el core con código ≠ 0, espera 500 ms y repite todo (canal nuevo). Tres caídas en 60 s → diálogo de error y no reintenta más. Al cerrar la app, mata el core.
- `core-entry.ts`: espera el mensaje `port` en `process.parentPort`, construye el `Transport` sobre ese puerto y llama a `startCore`. `decrypt` se resuelve preguntando a main por `process.parentPort` (`{type:'decrypt', id, cipher}` → `{type:'decrypted', id, plain}`). Rutas por variables de entorno que main pasa al hacer fork: `REV_DB_PATH` (`<userData>/rev-studio.db`), `REV_RG_PATH`.
- `secrets.ts`: `safeStorage.encryptString` / `decryptString`, en base64. Si `safeStorage.isEncryptionAvailable()` es falso, `encryptSecret` rechaza con mensaje claro.
- IPC de main: `pick-folder`, `encrypt-secret`, `open-external` (solo URLs `https:`), `app-info`.
- Variables solo para pruebas: `REV_STUDIO_USER_DATA` (sustituye `userData`), `REV_STUDIO_PICK_FOLDER` (lo que devuelve `pickFolder` sin abrir diálogo), `REV_STUDIO_FAKE_SCRIPT` (activa el proveedor fake).
- Ventana: 1280×800, mínimo 900×600, `webPreferences` según Global Constraints; navegación y `window.open` bloqueados.
- `CoreClient`: ids incrementales; valida respuestas y eventos con los esquemas; ignora mensajes que no validan (los registra en consola).
- `App.tsx` en esta tarea: crea el `CoreClient` al recibir el puerto, llama a `projects.list` y muestra `"Rev Studio"` y el número de proyectos (se sustituye en la Tarea 11).
- `launchApp`: crea carpetas temporales para `userData` y para un proyecto con `src/auth.ts` (contenido `export const ok = false\n`), escribe el guion en un archivo y lanza Electron con las tres variables.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// client.test.ts (con MessageChannel de node:worker_threads como puerto)
it('call resuelve con el result de la respuesta con el mismo id')
it('call rechaza con CoreCallError y su code cuando llega error')
it('onEvent recibe eventos válidos e ignora los inválidos')
it('close rechaza las llamadas pendientes')
// e2e/smoke.spec.ts
test('la ventana abre y el renderer habla con el core', async () => {
  // launchApp(); expect(page.getByText('Rev Studio')).toBeVisible(); expect(page.getByText('0 proyectos')).toBeVisible()
})
test('si el core muere, se reinicia y el renderer vuelve a conectar', async () => {
  // matar el proceso utility desde app.evaluate; esperar a que '0 proyectos' vuelva a mostrarse tras recargar el estado
})
```

- [ ] **Step 2: Ejecutar** `pnpm --filter @rev/desktop test` y `pnpm --filter @rev/desktop e2e` → FALLAN.
- [ ] **Step 3: Implementar** la configuración y los archivos listados. Scripts del paquete: `dev` (`electron-vite dev`), `build` (`electron-vite build`), `test` (`vitest run`), `e2e` (`electron-vite build && playwright test`).
- [ ] **Step 4: Ejecutar** ambos → PASAN. Ejecutar `pnpm --filter @rev/desktop dev` y comprobar a mano que la ventana abre.
- [ ] **Step 5: Añadir a `ci.yml`** el paso `pnpm --filter @rev/desktop e2e` en ambas plataformas.
- [ ] **Step 6: Commit** `feat(desktop): electron shell with core utility process`.

---

### Task 11: UI — estructura, proyectos, sesiones y ajustes

**Files:**
- Create: `apps/desktop/src/renderer/state/app-store.ts`, `apps/desktop/src/renderer/components/{Sidebar,Settings,FirstRun,ModelPicker}.tsx`, `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/electron.vite.config.ts` (Tailwind)
- Test: `apps/desktop/src/renderer/state/app-store.test.ts`, `apps/desktop/e2e/smoke.spec.ts` (ampliar)

**Interfaces**
- Consumes: `CoreClient`, `window.rev` (T10).
- Produces:

```ts
// app-store.ts (Zustand)
interface AppState { projects: Project[]; sessionsByProject: Record<string, Session[]>;
  providers: ProviderStatus[]; activeProjectId: string | null; activeSessionId: string | null;
  view: 'main' | 'settings';
  init(client: CoreClient): Promise<void>            // carga proyectos, proveedores y ajustes
  addProject(): Promise<void>                        // window.rev.pickFolder → projects.add
  removeProject(id: string): Promise<void>
  createSession(projectId: string): Promise<void>    // usa modelo por defecto o el primero disponible
  selectSession(projectId: string, sessionId: string): void
  applyEvent(e: CoreEvent): void }                   // turn.status actualiza Session.turnStatus
```

Decisiones:
- Instalar Tailwind y shadcn/ui (componentes: button, dialog, input, select, tabs, tooltip, scroll-area, resizable). Tema claro/oscuro con `prefers-color-scheme`.
- `App.tsx`: tres paneles redimensionables (`Sidebar` | centro | derecha). En esta tarea centro y derecha muestran marcadores vacíos; se rellenan en las Tareas 12 y 13.
- `Sidebar`: árbol proyectos → sesiones; botón `+ Proyecto`; botón `+` por proyecto para nueva sesión; menú contextual con `Quitar proyecto` y `Eliminar sesión`; punto indicador cuando `turnStatus === 'running'` o hay aprobación pendiente; proyecto no disponible en gris con acciones `Reubicar` y `Quitar`; botón `Ajustes`.
- `Settings`: lista de proveedores con estado (`Conectado` / `Sin conexión`), formulario (nombre, tipo, URL, clave, tamaño de contexto). La clave se cifra con `window.rev.encryptSecret` antes de `providers.save`; el campo nunca muestra una clave guardada, solo `Clave guardada`. Sección de modelo por defecto (`ModelPicker`) y sección de reglas `permitir siempre` por proyecto con botón para borrar cada una.
- `ModelPicker`: selector agrupado por proveedor, alimentado por `providers.models`. Al elegir, llama a `providers.capabilities`: `tools: 'no'` → no permite seleccionar y muestra `Este modelo no admite herramientas y no sirve para el modo Code.`; ventana < 32 000 → aviso `Ventana de contexto pequeña (N tokens); el agente puede perder contexto.`
- `FirstRun`: se muestra si ningún proveedor está accesible. Dos opciones: `Instalar Ollama` (abre `https://ollama.com/download` y muestra el comando `ollama pull qwen3:14b` como sugerencia editable en una constante `SUGGESTED_MODEL`) y `Configurar un endpoint` (abre Ajustes). Botón `Volver a comprobar`.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// app-store.test.ts (CoreClient simulado)
it('init carga proyectos y proveedores')
it('addProject no hace nada si pickFolder devuelve null')
it('createSession usa el modelo por defecto de settings; si no hay, el primer modelo del primer proveedor accesible')
it('applyEvent turn.status actualiza turnStatus de la sesión correcta')
// smoke.spec.ts
test('añadir proyecto y crear sesión aparecen en la barra lateral')
test('Ajustes muestra el proveedor fake como Conectado')
```

- [ ] **Step 2: Ejecutar** → FALLAN.
- [ ] **Step 3: Implementar** store y componentes.
- [ ] **Step 4: Ejecutar** `pnpm --filter @rev/desktop test && pnpm --filter @rev/desktop e2e` → PASAN.
- [ ] **Step 5: Revisión visual** con `pnpm --filter @rev/desktop dev`: tema claro y oscuro, redimensionado de paneles, pantalla de primer arranque con Ollama apagado.
- [ ] **Step 6: Commit** `feat(desktop): layout, projects, sessions and settings`.

---

### Task 12: UI — chat

**Files:**
- Create: `apps/desktop/src/renderer/state/session-state.ts`, `apps/desktop/src/renderer/components/{Chat,ToolLine,ApprovalCard,Composer}.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/state/app-store.ts`
- Test: `apps/desktop/src/renderer/state/session-state.test.ts`, `apps/desktop/e2e/code-flow.spec.ts`

**Interfaces**
- Consumes: `CoreClient`, `AppState`, `ModelPicker` (T11).
- Produces:

```ts
// session-state.ts — reductor puro, una instancia por sesión
interface ToolCallView { callId: string; name: string; input: unknown; output: string | null; isError: boolean; running: boolean }
interface SessionView { messages: StoredMessage[]; streamingText: string;
  toolCalls: Record<string, ToolCallView>; approvals: ApprovalRequest[];
  usedTokens: number; windowTokens: number | null;
  changedPaths: string[] }                          // lo usa la Tarea 13
fromSnapshot(s: ResultOf<'sessions.get'>): SessionView
reduceSession(view: SessionView, e: CoreEvent): SessionView
```

Decisiones:
- `app-store` guarda `sessionViews: Record<string, SessionView>`; `selectSession` llama a `sessions.get` y `fromSnapshot`; `applyEvent` aplica `reduceSession` a la vista de `e.sessionId` si está cargada. Tras reconectar con el core (nuevo puerto) se recargan las vistas cargadas.
- `reduceSession`: `text.delta` acumula en `streamingText`; `message.added` añade el mensaje y, si es `assistant`, vacía `streamingText`; `tool.started`/`tool.finished` actualizan `toolCalls`; `approval.requested`/`approval.resolved` añaden y quitan; `context.usage` actualiza tokens; `file.changed` añade la ruta a `changedPaths` sin duplicar.
- `Chat`: cabecera con `ModelPicker` (llama a `sessions.setModel`; deshabilitado con turno en curso) y medidor `contexto N %` (oculto si `windowTokens` es null). Lista de mensajes con `react-markdown` + Shiki; autoscroll solo si el usuario está al final. Mensajes `summary` se muestran como separador `Contexto resumido`. Mensajes `tool` no se pintan aparte: sus resultados aparecen en la `ToolLine` de su llamada.
- `ToolLine`: una línea plegada `▸ nombre  argumento-principal  resumen` (argumento principal: `path`, `query`, `pattern` o `command`); al expandir muestra entrada y salida completas; estado en curso con indicador; error en rojo.
- `ApprovalCard`: para `diff`, ruta y diff de líneas (librería `diff`, sin Monaco) limitado a 300 líneas con `ver completo`; para `command`, el comando completo en monoespaciado y el `cwd`. Botones `Permitir`, `Siempre en este proyecto`, `Denegar` → `approval.resolve`. Para un comando encadenado, el botón `Siempre en este proyecto` se oculta.
- `Composer`: área de texto; Enter envía, Shift+Enter salto de línea; con `turnStatus === 'running'` el botón es `Detener` (`turn.stop`). Con `interrupted` o `failed` se muestra el error y un botón `Reintentar` (`turn.retry`).

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// session-state.test.ts
it('text.delta acumula y message.added de assistant vacía streamingText')
it('tool.started crea la llamada en running; tool.finished guarda salida y error')
it('approval.requested añade y approval.resolved quita')
it('file.changed añade la ruta una sola vez')
it('fromSnapshot reconstruye toolCalls a partir de tool-call y tool-result guardados')
it('eventos de otra sesión no cambian la vista')
// e2e/code-flow.spec.ts — guion: [tool-call read_file src/auth.ts] → [tool-call edit_file false→true] → [text "Listo"]
test('flujo completo de edición con aprobación', async () => {
  // añadir proyecto, crear sesión, escribir "arregla el flag" y Enter
  // aparece la línea de read_file; aparece la tarjeta con "- export const ok = false" y "+ export const ok = true"
  // el archivo en disco sigue con false; clic en Permitir; aparece "Listo"; el archivo en disco tiene true
})
test('Denegar deja el archivo intacto y el turno continúa')
test('Detener durante la aprobación deja el turno interrumpido y muestra Reintentar')
```

- [ ] **Step 2: Ejecutar** → FALLAN.
- [ ] **Step 3: Implementar** reductor y componentes.
- [ ] **Step 4: Ejecutar** `pnpm --filter @rev/desktop test && pnpm --filter @rev/desktop e2e` → PASAN.
- [ ] **Step 5: Prueba manual con Ollama real:** pedir un cambio pequeño en un proyecto de prueba, aprobarlo y comprobar el streaming, las líneas de herramientas y el medidor de contexto.
- [ ] **Step 6: Commit** `feat(desktop): chat with tool activity and approvals`.

---

### Task 13: UI — panel de archivos y cambios

**Files:**
- Create: `apps/desktop/src/renderer/components/{FilesPanel,FileTree,ChangesList,Editor}.tsx`, `apps/desktop/src/renderer/monaco-setup.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/state/app-store.ts`
- Test: `apps/desktop/src/renderer/state/app-store.test.ts` (ampliar), `apps/desktop/e2e/code-flow.spec.ts` (ampliar)

**Interfaces**
- Consumes: `CoreClient`, `SessionView.changedPaths`, eventos `tree.changed` y `file.changed`.
- Produces (añadido a `AppState`):

```ts
treeByProject: Record<string, Record<string, DirEntry[]>>     // projectId → dir → entradas
openFile: { projectId: string; path: string; content: string; dirty: boolean } | null
openDiff: { sessionId: string; path: string; original: string | null; current: string | null } | null
changesBySession: Record<string, ChangedFile[]>
loadDir(projectId: string, dir: string): Promise<void>
openPath(projectId: string, path: string): Promise<void>
saveOpenFile(content: string): Promise<void>
refreshChanges(sessionId: string): Promise<void>
showDiff(sessionId: string, path: string): Promise<void>
revertFile(sessionId: string, path: string): Promise<void>
```

Decisiones:
- `monaco-setup.ts`: importar `monaco-editor` desde el paquete local y configurar `@monaco-editor/react` con `loader.config({ monaco })` y los workers mediante imports `?worker` de Vite. Nada se carga desde CDN.
- `FilesPanel`: pestañas `Archivos` y `Cambios (N)`; debajo, el `Editor`.
- `FileTree`: carga la raíz al seleccionar proyecto y cada carpeta al expandirla. `tree.changed` recarga esa carpeta solo si está cargada. Las rutas en `changedPaths` de la sesión activa llevan una marca `M`.
- `Editor`: modo archivo (Monaco editable; Cmd/Ctrl+S → `saveOpenFile`; indicador de cambios sin guardar) o modo diff (`DiffEditor` de solo lectura, original a la izquierda). Errores `too_large` → `Archivo demasiado grande para abrirlo (más de 2 MB).`; `binary` → `Archivo binario; no se puede mostrar.`
- Si llega `file.changed` o `tree.changed` para el archivo abierto y no hay cambios sin guardar, se recarga; si los hay, se muestra un aviso `El archivo cambió en disco` con `Recargar`.
- `ChangesList`: se refresca al seleccionar sesión y con cada `file.changed` de esa sesión. Cada fila muestra ruta, estado (`modificado`, `creado`, `eliminado`) y botón `Revertir`, que pide confirmación en un diálogo y después refresca la lista.

- [ ] **Step 1: Escribir las pruebas que fallan:**

```ts
// app-store.test.ts
it('tree.changed recarga la carpeta solo si ya estaba cargada')
it('file.changed de la sesión activa llama a changes.list')
it('openPath con error too_large guarda el mensaje de error y no abre el archivo')
it('file.changed del archivo abierto lo recarga si no está dirty y no lo toca si lo está')
// code-flow.spec.ts (continúa el flujo de edición aprobada)
test('el árbol muestra src/auth.ts con marca M y la pestaña dice Cambios (1)')
test('seleccionar el cambio muestra el diff con false a la izquierda y true a la derecha')
test('Revertir restaura el archivo en disco y deja Cambios (0)')
test('abrir un archivo, editarlo y guardar con Ctrl/Cmd+S lo escribe en disco')
```

- [ ] **Step 2: Ejecutar** → FALLAN.
- [ ] **Step 3: Implementar** componentes, `monaco-setup.ts` y las acciones del store.
- [ ] **Step 4: Ejecutar** `pnpm --filter @rev/desktop test && pnpm --filter @rev/desktop e2e` → PASAN.
- [ ] **Step 5: Revisión visual** en `dev`: árbol de un proyecto real grande, diff en tema claro y oscuro, aviso de archivo cambiado en disco.
- [ ] **Step 6: Commit** `feat(desktop): files panel, editor and session changes`.

---

### Task 14: Empaquetado, releases y aviso de versión

**Files:**
- Create: `apps/desktop/electron-builder.yml`, `apps/desktop/build/icon.png`, `apps/desktop/src/main/update-check.ts`, `.github/workflows/release.yml`, `docs/INSTALAR.md`, `docs/PRUEBA-MANUAL.md`
- Modify: `apps/desktop/src/main/{index,core-process}.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/src/main/update-check.test.ts`

**Interfaces**
- Produces:

```ts
// update-check.ts
RELEASES_REPO: string                                // '<propietario>/rev-studio', se fija en el paso 1
isNewer(latest: string, current: string): boolean    // semver, tolera prefijo 'v'
checkForUpdate(current: string, fetchImpl?: typeof fetch): Promise<{ version: string; url: string } | null>
// preload: window.rev.checkForUpdate(): Promise<{ version: string; url: string } | null>
```

Decisiones:
- `checkForUpdate`: `GET https://api.github.com/repos/${RELEASES_REPO}/releases/latest`; usa `tag_name` y `html_url`. Cualquier fallo (sin red, 404, límite de peticiones) devuelve `null` sin avisar al usuario.
- El renderer llama una vez al arrancar; si hay versión nueva muestra una barra `Hay una versión nueva (vX.Y.Z)` con botón `Descargar` (`openExternal`).
- `electron-builder.yml`: `appId: com.revsystems.revstudio`, `productName: Rev Studio`; `mac.target: dmg`, `arch: arm64`, `identity: null` (sin firma de desarrollador; firma ad hoc); `win.target: nsis`, `arch: x64`; `asarUnpack` del binario de `@vscode/ripgrep`; salida en `release/`.
- En la app empaquetada, `core-process.ts` calcula `REV_RG_PATH` apuntando a `app.asar.unpacked`; en desarrollo usa `rgPath` de `@vscode/ripgrep`.
- `release.yml`: al hacer push de una etiqueta `v*`, matriz macOS (arm64) y Windows; instala, ejecuta `pnpm typecheck`, `pnpm test`, e2e, construye con `electron-builder --publish never` y sube `.dmg` y `.exe` a la release de la etiqueta con `softprops/action-gh-release`. Permiso `contents: write`.
- `docs/INSTALAR.md` (español, para los amigos): descarga desde Releases; en macOS, abrir, ver el bloqueo, ir a Ajustes del Sistema → Privacidad y seguridad → `Abrir igualmente`; en Windows, `Más información` → `Ejecutar de todas formas`; instalar Ollama y descargar un modelo; requisitos (Apple Silicon o Windows x64, 16 GB de RAM).
- `docs/PRUEBA-MANUAL.md`: lista fija antes de cada versión, con Ollama real en ambas plataformas: (1) el primer arranque detecta Ollama; (2) pedir un cambio de una línea y aprobarlo; (3) pedir ejecutar las pruebas del proyecto y aprobar con `Siempre en este proyecto`, repetir y comprobar que no pregunta; (4) `Detener` durante un comando largo; (5) revertir un archivo; (6) cerrar la app a mitad de turno y comprobar que reabre con el turno interrumpido; (7) apagar Ollama a mitad de turno y usar `Reintentar`; (8) proyecto en una ruta con espacios y acentos.

- [ ] **Step 1 (requiere al usuario): crear el repositorio público en GitHub.** Preguntar el nombre de cuenta u organización, crear `rev-studio` como público, añadir el remoto y hacer push de la rama. Fijar `RELEASES_REPO`.
- [ ] **Step 2: Escribir las pruebas que fallan:**

```ts
it('isNewer("v0.2.0","0.1.9") true; ("0.1.0","0.1.0") false; ("0.1.10","0.1.9") true; ("0.1.0","0.2.0") false')
it('checkForUpdate devuelve versión y url cuando tag_name es más nuevo')
it('devuelve null si es la misma versión')
it('devuelve null si fetch falla o responde 404 o 403')
```

- [ ] **Step 3: Ejecutar** `pnpm --filter @rev/desktop test -- update-check` → FALLA.
- [ ] **Step 4: Implementar** `update-check.ts`, el IPC, el puente de preload y la barra de aviso.
- [ ] **Step 5: Ejecutar** → PASA.
- [ ] **Step 6: Empaquetar en local:** `pnpm --filter @rev/desktop build && pnpm --filter @rev/desktop exec electron-builder --mac --arm64`. Instalar el `.dmg` resultante, abrir la app, añadir un proyecto y ejecutar una búsqueda con el agente para confirmar que ripgrep empaquetado funciona.
- [ ] **Step 7: Escribir** `release.yml`, `INSTALAR.md` y `PRUEBA-MANUAL.md`.
- [ ] **Step 8: Commit** `feat: packaging, release workflow and update notice`.
- [ ] **Step 9 (requiere al usuario): publicar `v0.1.0`.** Tras confirmar, crear y subir la etiqueta; comprobar que la release contiene `.dmg` y `.exe`; instalar el `.exe` en un equipo Windows y recorrer `PRUEBA-MANUAL.md` en ambas plataformas.
