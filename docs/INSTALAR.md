# Instalar Rev Studio

Rev Studio es una app de escritorio donde un agente con modelos abiertos lee, busca y edita los archivos de una carpeta de proyecto y ejecuta comandos en ella. Siempre te pide permiso antes de cambiar un archivo o ejecutar algo.

## Requisitos

- **Mac** con Apple Silicon (M1, M2, M3, M4…) o con procesador Intel, o **PC con Windows 10/11** de 64 bits.
- **16 GB de RAM** como mínimo para los modelos recomendados.
- Unos 10 GB libres para el modelo.

## 1. Descargar

Entra en la página de versiones: <https://github.com/revsystemscode/rev-studio/releases>

En la versión más reciente, abre **Assets** y descarga el archivo que corresponda a tu equipo:

| Equipo | Archivo |
| --- | --- |
| Mac con Apple Silicon (M1 o posterior) | `Rev-Studio-X.Y.Z-mac-arm64.dmg` |
| Mac con Intel | `Rev-Studio-X.Y.Z-mac-x64.dmg` |
| Windows | `Rev-Studio-X.Y.Z-win-x64.exe` |

¿No sabes qué Mac tienes? Menú  → **Acerca de este Mac**: si pone «Chip Apple M…», es Apple Silicon; si pone «Procesador Intel…», es Intel.

## 2. Instalar

### macOS

1. Abre el `.dmg` y arrastra **Rev Studio** a la carpeta **Aplicaciones**.
2. Abre Rev Studio desde Aplicaciones. La primera vez macOS lo bloquea con un aviso de que no puede comprobar la app: es normal, porque la app no está firmada con un certificado de Apple. Pulsa **Aceptar** (no la muevas a la papelera).
3. Ve a **Ajustes del Sistema → Privacidad y seguridad**. Abajo verás «Se ha bloqueado el uso de "Rev Studio"…». Pulsa **Abrir igualmente** y confirma con tu contraseña o Touch ID.
4. Vuelve a abrir Rev Studio y pulsa **Abrir** en el último aviso. A partir de ahí se abre con normalidad.

Si macOS dice que la app «está dañada», abre la app **Terminal** y ejecuta:

```sh
xattr -dr com.apple.quarantine "/Applications/Rev Studio.app"
```

### Windows

1. Abre el `.exe`. Windows puede mostrar «Windows protegió su PC» porque la app no está firmada.
2. Pulsa **Más información** y después **Ejecutar de todas formas**.
3. La instalación es automática y crea un acceso directo **Rev Studio**.

## 3. Instalar un modelo con Ollama

Rev Studio usa modelos que se ejecutan en tu propio equipo.

1. Descarga e instala Ollama desde <https://ollama.com/download> y ábrelo.
2. Abre la Terminal (macOS) o PowerShell (Windows) y descarga un modelo que admita herramientas:

   ```sh
   ollama pull qwen3:14b
   ```

   Son unos 9 GB; tarda según tu conexión.
3. Abre Rev Studio. Si Ollama está en marcha, la app lo detecta sola. Si no lo detecta, pulsa **Volver a comprobar**.

¿Usas LM Studio u otro servidor compatible con la API de OpenAI? Ve a **Ajustes → Añadir proveedor** e indica su URL y, si hace falta, su clave.

## 4. Primeros pasos

1. Pulsa **+ Proyecto** y elige la carpeta de tu proyecto.
2. Pulsa **+** junto al proyecto para crear una sesión.
3. Escribe lo que quieres cambiar. Cuando el agente quiera editar un archivo o ejecutar un comando, verás una tarjeta con el cambio exacto y los botones **Permitir**, **Siempre en este proyecto** y **Denegar**.
4. En la pestaña **Cambios** ves todo lo que ha tocado la sesión y puedes **Revertir** cualquier archivo.

## Actualizaciones

Cuando haya una versión nueva, Rev Studio mostrará arriba «Hay una versión nueva» con un botón **Descargar**. Descarga el instalador e instálalo encima del anterior: tus proyectos y sesiones se conservan.
