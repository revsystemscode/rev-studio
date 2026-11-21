# Prueba manual antes de cada versión

Recorre esta lista **en macOS y en Windows** con **Ollama real** y un modelo con herramientas (por ejemplo `qwen3:14b`) antes de publicar una versión. Usa la app instalada desde el instalador de la release candidata, no `pnpm dev`.

Prepara un proyecto de prueba pequeño con pruebas automáticas que tarden poco (por ejemplo, un proyecto Node con `npm test`) y un archivo con un valor fácil de cambiar.

Versión probada: `v____`  ·  Fecha: `____`  ·  Modelo: `____`

| # | Prueba | Pasos | Resultado esperado | macOS | Windows |
| --- | --- | --- | --- | --- | --- |
| 1 | Primer arranque | Con Ollama abierto, borra los datos de la app (o usa un usuario nuevo) y ábrela. | No aparece la pantalla «Conecta un modelo»; en **Ajustes**, Ollama sale como **Conectado**. Con Ollama cerrado sí aparece esa pantalla y **Volver a comprobar** la quita al abrir Ollama. | ☐ | ☐ |
| 2 | Cambio de una línea | Añade el proyecto, crea una sesión y pide cambiar un valor concreto de un archivo. Aprueba con **Permitir**. | Se ve el texto llegando poco a poco, las líneas de herramientas (`read_file`, `edit_file`) y la tarjeta con el diff correcto. Tras aprobar, el archivo cambia en disco, sale en **Cambios (1)** con marca **M** en el árbol, y el medidor de contexto muestra un porcentaje. | ☐ | ☐ |
| 3 | Permiso guardado | Pide ejecutar las pruebas del proyecto. Aprueba con **Siempre en este proyecto**. Repite la petición. | La segunda vez el comando se ejecuta sin preguntar. La regla aparece en **Ajustes → Permisos guardados** y se puede borrar. | ☐ | ☐ |
| 4 | Detener un comando largo | Pide ejecutar un comando que tarde (por ejemplo `node -e "setTimeout(()=>{},60000)"`), apruébalo y pulsa **Detener** a los pocos segundos. | El turno se detiene en uno o dos segundos, aparece «El turno se interrumpió» con **Reintentar** y no queda ningún proceso `node` colgado. | ☐ | ☐ |
| 5 | Revertir | En **Cambios**, pulsa **Revertir** en el archivo de la prueba 2 y confirma. | El archivo vuelve a su contenido original en disco, desaparece de la lista y el editor lo muestra sin el cambio. | ☐ | ☐ |
| 6 | Cerrar a mitad de turno | Pide un cambio y cierra la app mientras el agente trabaja. Vuelve a abrirla. | La sesión abre con el turno interrumpido y **Reintentar**; los mensajes anteriores siguen ahí. | ☐ | ☐ |
| 7 | Ollama se cae | Pide un cambio y cierra Ollama a mitad de turno. Vuelve a abrir Ollama y pulsa **Reintentar**. | El turno falla con un mensaje claro. Tras **Reintentar**, continúa y termina. | ☐ | ☐ |
| 8 | Ruta con espacios y acentos | Repite la prueba 2 con un proyecto en una carpeta como `Mis proyectos/José prueba`. | Lectura, búsqueda, edición y comandos funcionan igual. | ☐ | ☐ |

Si algo falla, anota la plataforma, los pasos exactos y lo que pasó, y no publiques la versión hasta resolverlo.
