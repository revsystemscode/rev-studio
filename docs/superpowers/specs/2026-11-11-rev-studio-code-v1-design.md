# Rev Studio v1 (modo Code): diseño

Fecha: 2026-11-11 · Estado: pendiente de revisión

## 1. Objetivo

Rev Studio es una app de escritorio con un agente de IA que trabaja con modelos abiertos, inspirada en la arquitectura de Bionic (LM Studio). Es para uso propio y para compartir con un grupo pequeño de amigos; no es un producto comercial.

La v1 cubre el **modo Code**: abrir una carpeta de proyecto y conversar con un agente que lee, busca y edita archivos y ejecuta comandos, con aprobación del usuario y visibilidad completa de lo que cambió.

### Criterios de éxito

1. Con Ollama o LM Studio en marcha y un modelo con tool calling, el usuario abre una carpeta, pide un cambio de código y el agente lo realiza de principio a fin.
2. Ningún archivo se modifica y ningún comando se ejecuta sin una aprobación (puntual o guardada).
3. El usuario ve en todo momento qué archivos cambió la sesión, su diff frente al original, y puede revertir cada uno.
4. La app se instala y funciona en macOS (Apple Silicon) y Windows (x64).
5. Cerrar la app o un fallo del núcleo no pierde conversaciones ya guardadas.

### Dentro de la v1

- Proyectos (carpetas) y sesiones de chat múltiples por proyecto, que pueden ejecutarse en paralelo.
- Agente con siete herramientas: `list_dir`, `read_file`, `find_files`, `search`, `edit_file`, `write_file`, `run_command`.
- Permisos por herramienta, jaula de carpeta, instantáneas y revertir.
- Proveedores: Ollama, LM Studio, endpoint OpenAI-compatible.
- Panel de archivos: árbol, visor/editor Monaco, lista de cambios con diff.
- Instaladores para Mac y Windows generados en GitHub Actions.

### Fuera de la v1 (subproyectos posteriores, cada uno con su spec)

- Motor de inferencia integrado (`llama-server`) y descarga de modelos.
- Modo asistente general y modo Work (documentos Office/PDF).
- MCP, skills, sub-agentes, lista de tareas/plan, búsqueda semántica.
- Terminal integrada, integración con git (rama, commit).
- Navegador, voz, control del equipo, uso remoto.
- Firma de código, auto-actualización, telemetría, Linux, Mac Intel.

## 2. Arquitectura

### Estructura del repositorio

Monorepo con pnpm workspaces, todo en TypeScript:

```
rev-studio/
├─ packages/
│  ├─ protocol/   Esquemas Zod de los mensajes UI ↔ núcleo
│  └─ core/       Agente, proveedores, herramientas, permisos, base de datos
└─ apps/
   └─ desktop/    Electron (main + preload) y UI React
```

`core` no importa nada de Electron. `protocol` no depende de `core` ni de `desktop`.

### Procesos

| Proceso | Responsabilidad | Restricción |
|---|---|---|
| **Main** (Electron) | Ventanas, menús, selector de carpeta, cifrado de claves con `safeStorage`, arrancar y vigilar el core | No ejecuta lógica del agente |
| **Core** (`utilityProcess`) | Bucle del agente, llamadas al modelo, herramientas, SQLite, vigilancia de archivos | No importa Electron |
| **Renderer** (React) | Toda la interfaz | No accede a disco ni red; `contextIsolation` activo, sin `nodeIntegration` |

### Comunicación

Main crea un `MessageChannelMain` y entrega un puerto al core y otro al renderer (vía preload). A partir de ahí hablan directamente. Tres formas de mensaje, definidas con Zod en `protocol` y validadas al recibir en ambos lados:

- **Petición:** `{ id, method, params }` del renderer al core.
- **Respuesta:** `{ id, result }` o `{ id, error: { code, message } }`.
- **Evento:** `{ type, sessionId?, ... }` del core al renderer, sin respuesta.

Peticiones principales: gestionar proyectos, sesiones y proveedores; enviar mensaje; detener turno; resolver una aprobación; listar carpeta; leer y guardar archivo; obtener cambios de la sesión; revertir archivo.

Eventos principales: fragmento de texto del modelo; herramienta iniciada / terminada; aprobación pendiente; archivo modificado; árbol cambiado en disco; uso de contexto; turno terminado / interrumpido / fallido.

### Recuperación

Si el core termina de forma inesperada, main lo reinicia y crea un canal nuevo. El renderer recarga la sesión desde la base de datos. Los turnos que estaban en curso quedan marcados como interrumpidos.

## 3. Agente

### Bucle

Cada mensaje del usuario inicia un turno. El core llama al modelo pasando historial y herramientas, ejecuta las herramientas pedidas, devuelve los resultados y repite hasta que el modelo responde sin pedir herramientas. El bucle es propio: cada paso es una única llamada al modelo a través de una interfaz interna (`ModelClient`), implementada con `fetch` en ambos casos: sobre la API nativa para Ollama y sobre `/chat/completions` (SSE) para los endpoints con formato OpenAI. No se usa el Vercel AI SDK.

- **Límite de pasos:** 50 llamadas al modelo por turno. Al alcanzarlo el turno termina con un aviso.
- **Detener:** cancela la petición al modelo (`AbortSignal`) y mata el comando en curso con su árbol de procesos.
- **Errores de herramienta:** se devuelven al modelo como resultado de error; el turno continúa.
- **Llamadas mal formadas:** el error de validación se devuelve al modelo. Tres seguidas detienen el turno y sugieren cambiar de modelo.
- **Recorte de salidas:** un resultado de herramienta se recorta a 400 líneas o 20 000 caracteres (lo que ocurra antes), conservando el principio y el final e indicando cuánto se omitió. `read_file` queda exento: tiene su propio límite de 2 000 líneas y 100 000 caracteres.
- **Compactación:** cuando el uso supera el 80 % de la ventana del modelo, el core pide al modelo un resumen de los turnos antiguos, lo guarda como mensaje de resumen y conserva íntegros los dos últimos turnos. Los mensajes originales siguen en la base de datos y visibles en el chat.
- **Sesiones en paralelo:** cada sesión tiene su propio bucle. Si dos sesiones editan el mismo archivo, la coincidencia exacta de `edit_file` hace fallar la edición obsoleta.

### Herramientas

| Herramienta | Comportamiento | Permiso por defecto |
|---|---|---|
| `list_dir` | Lista una carpeta | Permitido |
| `read_file` | Lee texto, con rango de líneas opcional, máximo 2 000 líneas por llamada; rechaza binarios | Permitido |
| `find_files` | Busca archivos por patrón glob | Permitido |
| `search` | ripgrep sobre el proyecto; respeta `.gitignore` | Permitido |
| `edit_file` | Reemplaza un texto exacto por otro; falla si no aparece o aparece más de una vez | Preguntar, con diff |
| `write_file` | Crea o sobrescribe un archivo | Preguntar, con diff |
| `run_command` | Ejecuta un comando en la carpeta del proyecto | Preguntar siempre |

### Jaula de carpeta

Las seis herramientas de archivos resuelven la ruta real (`realpath`, incluidos enlaces simbólicos y la carpeta padre de archivos nuevos) y rechazan cualquier ruta fuera de la carpeta del proyecto. Las peticiones de la UI para leer y guardar archivos pasan por la misma comprobación.

`run_command` no puede enjaularse de este modo. Su protección es la aprobación del usuario; la tarjeta de aprobación muestra siempre el comando completo.

### Ejecución de comandos

- `child_process.spawn`, sin terminal interactiva; stdin cerrado.
- macOS: `/bin/zsh -lc "<comando>"`, para heredar el PATH del usuario aunque la app se abra desde Finder.
- Windows: `powershell.exe -NoProfile -Command "<comando>"`.
- Tiempo máximo: 120 s por defecto; el modelo puede pedir hasta 600 s.
- Al cancelar o agotar el tiempo se mata el árbol completo (grupo de procesos en macOS, `taskkill /T /F` en Windows) y se devuelve la salida parcial.

### Permisos

Cada aprobación ofrece: **Permitir** (una vez), **Siempre en este proyecto**, **Denegar**. Al denegar, el modelo recibe un resultado que indica que el usuario lo rechazó.

- Para `edit_file` y `write_file`, "siempre" cubre todas las ediciones del proyecto.
- Para `run_command`, "siempre" guarda el prefijo del comando (las dos primeras palabras, por ejemplo `npm test`). Un comando con operadores de encadenamiento (`&&`, `||`, `;`, `|`, redirecciones, sustituciones) nunca coincide con una regla guardada y siempre pregunta.

Las reglas se guardan por proyecto y se pueden borrar desde Ajustes.

### Instantáneas y revertir

Antes de la primera modificación de un archivo en una sesión (por el agente), el core guarda su contenido original, o una marca de "no existía". El panel Cambios compara ese original con el estado actual en disco. **Revertir** restaura el original (o borra el archivo si no existía) y elimina la instantánea. No depende de git.

## 4. Proveedores de modelos

### Interfaz

Cada proveedor implementa:

- `listModels()` — modelos disponibles.
- `getCapabilities(model)` — `{ tools: yes | no | unknown, contextWindow: number | unknown }`.
- `createModel(model)` — modelo utilizable por el AI SDK.

El agente solo depende de esta interfaz.

### Proveedores de la v1

| Proveedor | Conexión | Capacidades |
|---|---|---|
| **Ollama** | API nativa, `http://localhost:11434` por defecto. Detección automática al arrancar. | Leídas de la información del modelo. La ventana que se informa es la efectiva (la que la app pide), no el máximo del modelo. La app fija el tamaño de contexto en cada petición (32 768 por defecto, limitado al máximo del modelo, ajustable en Ajustes), porque el valor por defecto de Ollama es demasiado pequeño para un agente. |
| **LM Studio** | Formato OpenAI, `http://localhost:1234/v1` por defecto. Detección automática. | Las que informe su API; el resto, `unknown`. |
| **OpenAI-compatible** | URL base y clave introducidas por el usuario. | Ventana de contexto introducida a mano; tools `unknown` hasta comprobarlo. |

### Aviso de capacidades

Al seleccionar un modelo:

- `tools: no` → aviso bloqueante: el modelo no sirve para el modo Code.
- `tools: unknown` → el core hace una petición de prueba con una herramienta trivial y clasifica el resultado.
- Ventana menor de 32 000 tokens → aviso no bloqueante.

### Claves de API

Main cifra las claves con `safeStorage`. La base de datos guarda solo el valor cifrado. Main descifra y envía las claves al core al arrancarlo y cuando cambian; el core las mantiene solo en memoria. Nunca llegan al renderer después de introducirlas.

## 5. Datos

Un archivo SQLite en la carpeta de datos de la app (`app.getPath('userData')`), accedido solo por el core con `node:sqlite`. SQL directo, sin ORM. Migraciones numeradas aplicadas al arrancar dentro de una transacción; antes de migrar se copia el archivo. Si una migración falla, la app muestra el error y no continúa.

| Tabla | Contenido |
|---|---|
| `projects` | id, nombre, ruta de la carpeta |
| `sessions` | id, proyecto, título, proveedor, modelo, fechas |
| `messages` | id, sesión, orden, rol, contenido (JSON con texto, llamadas a herramientas y resultados), estado |
| `file_snapshots` | sesión, ruta, contenido original o marca de inexistente |
| `permissions` | proyecto, herramienta, patrón, decisión |
| `providers` | id, tipo, URL, clave cifrada, ajustes |

Cada mensaje se escribe al completarse. Un cierre inesperado pierde como mucho el paso en curso.

## 6. Interfaz

Tres columnas redimensionables. Idioma: español. Tema claro u oscuro según el sistema.

```
┌────────────┬──────────────────────────────┬─────────────────────────────┐
│ PROYECTOS  │ modelo ▾          contexto 41%│ [Archivos] [Cambios (3)]    │
│ ▾ mi-web   ├──────────────────────────────┼─────────────────────────────┤
│   • Login  │ mensajes, herramientas,      │ árbol / lista de cambios    │
│   • Tests  │ tarjetas de aprobación       ├─────────────────────────────┤
│ + Proyecto │                              │ Monaco (archivo o diff)     │
│ ⚙ Ajustes  │ [ mensaje…               ➤ ] │                             │
└────────────┴──────────────────────────────┴─────────────────────────────┘
```

- **Izquierda:** proyectos y sus sesiones. "+ Proyecto" abre el selector de carpeta. Una sesión con turno en curso o aprobación pendiente muestra un indicador.
- **Centro:** selector de modelo y medidor de contexto; mensajes en Markdown con código resaltado; llamadas a herramientas como líneas plegadas expandibles; tarjetas de aprobación (diff o comando completo) que bloquean el turno hasta responder; el botón de enviar pasa a **Detener** durante un turno; turnos interrumpidos o fallidos muestran **Reintentar**.
- **Derecha, pestaña Archivos:** árbol con carga perezosa por carpeta, `.git` oculto, marca en los archivos modificados por la sesión. Se actualiza con los eventos de `fs.watch` recursivo del core. Clic abre el archivo en Monaco; se puede editar y guardar con Cmd/Ctrl+S.
- **Derecha, pestaña Cambios:** archivos modificados en la sesión; al seleccionar uno, diff de Monaco entre original y actual; botón **Revertir** por archivo.
- **Ajustes:** proveedores (estado, URL, clave, tamaño de contexto), modelo por defecto, reglas de permiso guardadas.
- **Primer arranque:** si no se detecta ningún proveedor, pantalla con dos caminos: instalar Ollama (enlace y modelo sugerido) o configurar un endpoint.

Tecnología: React, Vite, Tailwind, shadcn/ui, Zustand, Monaco (editor y diff), `react-markdown` + Shiki.

## 7. Errores

| Situación | Comportamiento |
|---|---|
| Proveedor inaccesible o caído a mitad de turno | Turno marcado como fallido, mensaje con la causa, botón Reintentar |
| Llamada a herramienta mal formada | Error devuelto al modelo; tres seguidas detienen el turno |
| `edit_file` sin coincidencia única | Falla sin modificar el archivo |
| Ruta fuera del proyecto | Herramienta rechazada con error al modelo |
| Comando agota el tiempo | Árbol de procesos eliminado, salida parcial al modelo |
| Core caído | Reinicio automático; sesiones recargadas; turnos en curso interrumpidos |
| Migración fallida | App detenida con error visible; copia previa conservada |
| Carpeta de proyecto movida o borrada | Proyecto marcado como no disponible, con opción de reubicar o quitar |

## 8. Pruebas

- **Unitarias (Vitest) en `core` y `protocol`:**
  - Jaula de carpeta: `..`, rutas absolutas, enlaces simbólicos, rutas y unidades de Windows.
  - Cada herramienta contra carpetas temporales.
  - Permisos: reglas por prefijo y rechazo de comandos encadenados.
  - Instantáneas y revertir, incluidos archivos nuevos.
  - Bucle del agente con modelo simulado: límite de pasos, cancelación, errores de herramienta, llamadas mal formadas, compactación.
  - Migraciones de base de datos.
  - Esquemas del protocolo.
- **Extremo a extremo (Playwright sobre Electron), una prueba** con proveedor simulado: abrir proyecto, enviar mensaje, aprobar una edición, comprobar el archivo en disco, revertir.
- **Manual con Ollama real** antes de cada versión, con una lista corta de tareas fija.
- CI ejecuta todo en macOS y Windows.

## 9. Distribución

- `electron-builder`: `.dmg` para macOS arm64 y `.exe` (NSIS) para Windows x64. ripgrep empaquetado por plataforma.
- GitHub Actions compila, prueba y publica ambos instaladores como release al crear una etiqueta de versión.
- **Sin firma de código.** En macOS el usuario autoriza la primera apertura en Ajustes → Privacidad y seguridad; en Windows usa "Más información → Ejecutar de todas formas" en SmartScreen. Un documento breve de instalación lo explica.
- **Sin auto-actualización.** Al arrancar, la app consulta la última release y, si hay una versión nueva, muestra un enlace de descarga. El repositorio de GitHub es público, de modo que las releases se leen y descargan sin cuenta.
- Sin telemetría.

## 10. Decisiones registradas

| Decisión | Motivo |
|---|---|
| Electron + TypeScript | Un solo lenguaje; ecosistema Node para MCP y herramientas |
| Clientes de modelo propios, sin AI SDK | Solo hace falta una llamada en streaming tras una interfaz interna; menos dependencias y pruebas con respuestas simuladas |
| Núcleo como paquete sin Electron en `utilityProcess` | Aísla la UI de bloqueos, permite pruebas sin Electron y crecer sin tocar la interfaz |
| Proveedores externos primero, motor integrado después | Llegar antes a un agente usable; la interfaz de proveedor evita reescrituras |
| `node:sqlite` sin ORM | Sin módulos nativos que compilar por plataforma; seis tablas no justifican un ORM |
| `child_process` en lugar de `node-pty` | Evita otro módulo nativo; la terminal interactiva queda para una versión posterior |
| Diff de Monaco | Ya incluido con el editor |
| API nativa de Ollama | Permite fijar el tamaño de contexto |
