# Las tools de BlackCode

Un agente con tools prendidas puede actuar en la PC: leer y escribir archivos,
correr comandos (también en segundo plano), correr código, consultar bases
SQLite, usar la web, abrir cosas y mirar la pantalla. Este documento cuenta
cómo está armado, de dónde viene cada parte y qué falta.

## De dónde viene

Casi todo es código de NeonCode 1.11.3, portado tal cual (no reescrito): cada
función llegó con los comentarios que explican por qué existe, y con sus pruebas.
Fran aprobó publicarlo el 23/11/2026. Cada archivo de `main/tools/` dice en su
encabezado de qué parte de NeonCode salió y qué se le adaptó.

| Archivo | Qué es |
|---|---|
| `defs.cjs` | Las definiciones de las tools (nombre, descripción, argumentos) y sus dos formatos |
| `motor.cjs` | El despachador: por acá pasa TODA llamada. Registro, corte de bucles, permiso |
| `guardas.cjs` | Lo que la app le dice al modelo sobre lo que corrió, y lo que limpia de lo que escribe |
| `sesion.cjs` | La sesión de un turno: presupuesto de rondas y qué va al principio y al final de cada pedido |
| `base.cjs` | Carpeta de trabajo, escritura atómica, salida acotada de un proceso |
| `fs.cjs`, `diff.cjs` | `fs_read`, `fs_write`, `fs_edit`, `fs_delete` y el diff de la tarjeta de permiso |
| `shell.cjs` | `shell_exec` (PowerShell) y `cmd_exec` |
| `jobs.cjs` | `job_start`, `job_output`, `job_kill`: procesos que siguen vivos después del turno |
| `code.cjs` | `run_code`: un fragmento de Python o de Node, en una carpeta que se conserva |
| `sqlite.cjs` | `db_query` (la base propia del agente) y `sqlite_query` (un archivo que ya existe) |
| `search.cjs`, `code-search-worker.cjs` | `code_search`, que corre en un proceso aparte |
| `web.cjs` | `fetch`, `web_search`, `http_request` |
| `abrir.cjs` | `os_open`: abre un archivo, una carpeta o una URL como lo haría el usuario |
| `captura.cjs` | `screen_capture`: una foto de un monitor o de una ventana, que el modelo ve |
| `canvas.cjs`, `canvas-store.cjs` | `canvas`: documentos y código en el panel de al lado, y su base |
| `notas.cjs`, `notes-store.cjs` | `notepad` y `notepad_write`: la libreta del usuario, y su base |
| `delegar.cjs` | `delegate`: los subagentes |
| `memoria.cjs` | `remember` y `recall`: la memoria (la memoria en sí es `main/memoria.cjs`) |
| `skills.cjs` | `skill` y `create_skill`: las skills (las skills en sí son `main/skills.cjs`) |
| `navegador.cjs`, `browser/` | Las seis `browser_*` y el navegador que manejan (`agent-browser.cjs`), con su preload de sesión |
| `index.cjs` | Arma todo y es lo único que conoce el chat |

Los loops de cada proveedor están en `main/anthropic.cjs` y `main/venice.cjs`.
Son nuevos: se escribieron para BlackCode siguiendo las reglas de los de NeonCode y la
documentación de cada API.

## Los grupos

Las tools se prenden por grupo y por agente. Un agente nuevo nace con todas
prendidas (desde la 0.7.3; los de antes quedaron como estaban). Hay dos
lugares para cambiarlas: el botón de arriba a la derecha de la conversación (dice
cuántas lleva el agente y su menú cambia cada grupo) y el formulario del
agente. La barra de estado repite la cuenta.

| Grupo | Tools |
|---|---|
| Files | `fs_read`, `fs_write`, `fs_edit`, `fs_delete`, `code_search` |
| Commands | `shell_exec`, `cmd_exec`, `job_start`, `job_output`, `job_kill` |
| Code | `run_code` |
| Databases | `db_query`, `sqlite_query` |
| Web | `fetch`, `web_search`, `http_request` |
| Browser | `browser_navigate`, `browser_read`, `browser_click`, `browser_type`, `browser_press`, `browser_upload` |
| Desktop | `os_open` |
| Screen | `screen_capture` |
| Canvas | `canvas` |
| Notes | `notepad`, `notepad_write` |
| Subagents | `delegate` |
| Memory | `remember`, `recall` |
| Skills | `skill`, `create_skill` |

La pantalla va sola en su grupo: es lo más privado que una tool puede mirar
(lo que haya abierto, sin elegir qué), y se prende aparte de todo lo demás.

## La idea que ordena todo

Hay **un** registro de lo que pasó en el turno (`run.steps`) y lo leen los tres
que importan:

- **el modelo**, en un bloque que la app le pone al final de cada pedido;
- **las filas** de la conversación, una por llamada, con su estado;
- **el contador** que va debajo de la respuesta.

Si alguno dijera otra cosa, uno de los tres estaría mintiendo. Y la app enuncia
hechos, nunca juicios: «este turno no corrió ninguna tool» es siempre verdad;
«el modelo mintió» es una acusación que un falso positivo destruye.

El problema que esto ataca es que un modelo diga «listo, ya lo hice» sin haber
llamado nada. No es un problema de moral del modelo sino de dónde está la
evidencia: por eso el registro va al final del pedido, que es donde el modelo
decide, y no solo en el system prompt.

## Cómo corre una llamada

1. El modelo pide una tool. El loop del proveedor se la pasa a la sesión.
2. Si los argumentos no se pueden leer o no tienen la forma de la tool, no
   corre nada: queda su fila como fallida y el modelo recibe qué llegó.
3. El despachador (`runTool`) resuelve las rutas a absolutas una sola vez,
   anota el paso, y corta si el turno ya se frenó o si esa llamada viene
   repitiéndose en bucle.
4. En modo manual, la interfaz muestra la tarjeta de permiso con lo que va a
   correr y, si es un archivo, el diff. Un «no» deja la fila como rechazada.
5. Corre la tool. Un resultado que empieza con `error:` cuenta como fracaso
   aunque la tool no haya tirado.
6. El resultado vuelve al modelo, y la fila pasa a su estado final.

## Las medidas de guardrail

Los números son los del documento de guardrails de NeonCode.

| | Qué hace | En BlackCode |
|---|---|---|
| M1 | Cada llamada deja un paso con su desenlace | Sí |
| M2 | Filas con estado y contador incondicional | Sí |
| M3 | La última ronda va sin tools y la app declara el corte | Sí |
| M4 | El registro del turno al final de cada pedido | Sí |
| M5 | El protocolo de tools en el system prompt, con una línea de puente que las instrucciones del agente no pueden borrar | Sí |
| M6 | El registro de los turnos anteriores viaja plegado (`<tools_ran>`) | Sí |
| M7 | Una llamada escrita como texto se rescata y se corre | Sí, en el loop de Venice |
| M8 | Detectar «dije que lo hice» sin tools y pedir una revisión | **No.** Es la única que juzga texto, y tuvo tres postmortems por falsos positivos |
| M9 | Corte de bucles (la misma llamada fallando, o devolviendo lo mismo) | Sí |
| M10 | Pedir que se corran los tests después de editar código | No |
| M11 | Compactar un chat que no entra en el contexto | No |
| M12 | El recordatorio de arranque, cuando todavía no corrió nada | Sí |

## Lo que cada una guarda, y dónde

Las tools tienen su carpeta al lado de los documentos de la app:
`%APPDATA%\BlackCode\tools`.

- `code-workspace\`: la carpeta donde corre `run_code`. Se conserva de una
  llamada a la otra, con el entorno virtual de Python que arma la primera vez
  que se le pide un paquete (`pip`). Para Python hace falta tenerlo instalado;
  para Node se usa el de la propia app.
- `agent.db`: la base de `db_query`. Es una sola para todos los agentes.

SQLite es `node:sqlite`, el que viene con Node, y no `better-sqlite3` como en
NeonCode: no hay módulo nativo que recompilar con cada Electron. Dos cosas que
aquel traía y este no: `UPDATE` o `DELETE` con `LIMIT`, y la función
`soundex()`.

Los jobs viven fuera de los turnos: sobreviven al turno y al chat que los
arrancó (hasta 8 a la vez), el system prompt de cada turno lista los que siguen
vivos, y al cerrar la app se matan todos, con su árbol de procesos.

## El canvas

El agente deja ahí lo largo (un documento, un archivo de código) en vez de
volcarlo en el mensaje. Cómo está armado:

- **El cuerpo no viaja en la conversación.** El modelo sabe qué canvas tiene
  este chat por un bloque de su system prompt (`## Open canvases`, solo título,
  id y versión) y lee el contenido con `read`. El bloque se arma al empezar el
  turno, no en cada ronda.
- **Edición por fragmentos.** `edit` usa el mismo motor que `fs_edit`; `update`
  reemplaza todo y queda para cuando hace falta. La tarjeta de permiso de
  `edit`, `update` y `delete` muestra el cambio.
- **Su base es propia** (`canvas.db`, al lado de `agent.db`), porque con
  `db_query` el modelo puede hacer lo que quiera con la otra.
- **Dos formas de borrar.** El usuario borra del todo. El agente manda a una
  papelera que dura 7 días (en modo automático nadie aprobó ese borrado).
- **Los canales del panel** (`canvas:lista`, `:todos`, `:abrir`, `:guardar`,
  `:borrar`, `:restaurar`, `:exportar`, `:huerfanos`) están en `chat.cjs` y no
  se acotan a un chat: la biblioteca muestra los de todos. La tool sí.
- La interfaz está en `renderer/canvas.js`. Un documento se pinta con
  `markdown.js`; el código va sin resaltado.

## Las notas

La libreta del usuario, que el agente lee y escribe.

- **Dos tools y no una con `action`:** `notepad` solo lee (y por eso sus
  rondas no se cobran y repetirla no cuenta como bucle); `notepad_write`
  cambia cosas. Leer pide `query` porque la libreta crece sin techo.
- **Una nota es su texto:** no hay columna de título. La primera línea es el
  título, acá y en lo que lee el modelo.
- **Base propia** (`notes.db`), con la papelera en una tabla aparte, para que
  ninguna consulta «resucite» una nota borrada.
- **Dos formas de borrar,** como en el canvas: el usuario borra del todo; el
  agente manda a la papelera (7 días) y puede restaurar.
- **No hay un bloque de notas en el system prompt:** el modelo se entera de lo
  que hay llamando a `notepad`.
- Si la base no abre, las dos tools no se ofrecen (se decide antes del turno).
- Los canales de la vista (`notas:*`) están en `chat.cjs`; los cuerpos, en
  `notas.cjs` (`ipc`). Cuando el agente escribe, la vista se entera por
  `notas:evento`. La interfaz está en `renderer/notas.js`.

## El navegador

Un navegador de verdad, en un panel, que comparten el usuario y el agente.

- **La página es una capa nativa** (`WebContentsView`), no DOM ni `<webview>`
  (una webview heredaría el preload de la app, con todo su IPC). El proceso
  principal la pinta sobre el hueco que le deja el panel; el panel le manda
  dónde está ese hueco (`browser:bounds`) cada vez que cambia.
- **Como tapa todo**, la interfaz la apaga cuando pone algo encima («eclipse»,
  en `renderer/navegador.js`) y deja una foto de la página. Sin eso la tarjeta
  de permiso de una tool queda tapada y el turno colgado. También se apaga con
  otra vista de la app al frente y al minimizar.
- **Sin CDP para leer:** corre un script en cada frame de la página y arma un
  texto con lo visible y la lista de lo accionable (`ref_N`). Paginado: 12.000
  caracteres y 120 elementos por página.
- **Las tools exigen el panel abierto:** si no lo está, se lo piden a la
  interfaz (`browser:open`) y esperan hasta 3 segundos.
- **Sesión propia** (`persist:nix-browser`), sin preload de la app, con
  sandbox. Solo http y https (http, solo a direcciones locales o privadas).
  Permisos negados, descargas canceladas, `alert`/`confirm`/`prompt`
  neutralizados (un `alert` congelaba la pestaña).
- **En el system prompt:** los favoritos por nombre y la pestaña que el
  usuario tiene a la vista (título y dirección, no el contenido).
- Pestañas y favoritos se guardan en `%APPDATA%\BlackCode\tools`
  (`browser-pestanas.json`, `browser-favoritos.json`).
- Con `screenshot: true`, `browser_read` le manda al modelo una foto de la
  página, si el modelo ve (igual que `screen_capture`).

## Las imágenes

Hay dos caminos, y no son el mismo:

- **Las que hace `run_code`** (un gráfico guardado en su carpeta) se le
  muestran **al usuario**, en la fila de esa llamada. El modelo recibe la
  lista de archivos, no la imagen.
- **Las de `screen_capture`** se le muestran **al modelo** y además al
  usuario, que ve exactamente lo que vio el modelo. La foto se reescala a 1568
  px de lado largo y viaja en JPEG. Con Anthropic va adentro del resultado de
  esa llamada; con Venice, que no admite imágenes en un resultado, en un
  mensaje aparte detrás de los resultados de la ronda. Para leer letra chica,
  el modelo pide una `region` de una captura anterior y el recorte se hace
  sobre los píxeles reales.

Un modelo de Venice que no declara que acepta imágenes no recibe `screen_capture`, aunque
el agente la tenga prendida: la imagen le llegaría igual y Venice rebotaría el
pedido entero. Los de Anthropic ven todos.

Las imágenes quedan guardadas con el chat (hasta 4 por llamada), así que un
chat con muchas capturas pesa.

## El presupuesto de rondas

Un turno admite 15 rondas que corran algo que no sea leer. Las rondas de pura
lectura no se cobran («leer no es entregar»), con un tope de 45 vueltas reales.
Al llegar al tope, la ronda siguiente sale sin tools y con un aviso: el modelo
escribe qué hizo de verdad y qué quedó sin hacer, y el contador lo dice.

## Permiso

Dos modos, en Settings: **manual** (pregunta antes de cada llamada; es el de
fábrica) y **automático** (no pregunta nunca). En manual, la tarjeta tiene «no
preguntar más en este chat», que dura hasta cerrar la app.

**No hay más rejas que esa.** No hay límite de carpetas ni filtro de comandos:
una tool puede leer o escribir cualquier ruta que pueda el usuario de Windows y
correr cualquier comando. Es la decisión de NeonCode, y viene con el código.

## Lo que el modelo recibe cuando hay tools

Para que las rutas sean reales y no adivinadas, el system prompt lleva el
usuario de Windows, las carpetas de inicio, Escritorio, Documentos y Descargas,
la carpeta de trabajo y la fecha. Eso sale hacia el proveedor (Anthropic o
Venice) en cada pedido de un agente con tools.

## Los subagentes

`delegate` (grupo Subagents, desde la 0.13.0) le pasa un trabajo a un
**subagente**: un turno hijo que arranca con el contexto vacío (solo el brief),
trabaja con sus tools y le devuelve al agente UNA cosa, su informe. Lo que el
hijo leyó se queda en el hijo. Viene de NeonCode 1.11.3 (`runDelegate`,
`correrSubagente`), con sus textos tal cual; está en `main/tools/delegar.cjs`.

- **Qué es el hijo acá.** Una sesión de tools como la de cualquier turno
  (`crearSesion`, con `subagente`, `callPrefix` y `cwd`) y una llamada al
  proveedor (`responder`). Las dos cosas las inyecta la app: `delegar.cjs` no
  conoce a los proveedores.
- **Qué tools ve** (`activeToolNames` en `motor.cjs`): las del agente menos
  `delegate` (un solo nivel). Con `access: 'read'`, que es lo de fábrica, solo
  las de lectura (`READ_ROUND_TOOLS`); con `'full'`, todas. Varios hijos a la
  vez no reciben las del navegador que actúan (`BROWSER_ACTION_TOOLS`): la
  pestaña es una sola.
- **Cuántos.** Hasta 4 por llamada (`tasks`), a la vez. Varias llamadas a
  `delegate` en una ronda corren en serie.
- **Su system.** El de cualquier turno con tools más `SUBAGENT_NOTE`
  (`guardas.cjs`), y la línea de la mecánica que dice que su prosa de entre
  tools se descarta. Lleva las instrucciones del agente.
- **El informe.** La última ronda de texto del hijo (el texto se parte en
  rondas cada vez que su sesión cierra una). Vuelve con una cabecera que dice
  el modelo, qué tools corrió, cuánto tardó y cuántos tokens escribió, y con
  notas si lo frenaron, falló, se quedó sin pasos, lo cortó el largo o el
  modelo se negó. Techo: 24000 caracteres entre todos; la fila guarda 4000.
- **Las filas.** Las del hijo llegan con `sub` (el id de la fila de delegate)
  y `subN` (cuál hijo, si son varios): la interfaz las cuelga debajo y NO las
  manda de vuelta al modelo (`viaja` en `renderer/datos.js`). Sus ids van
  bajo el de delegate: `<pedido>:1.2:3` es el paso 3 del segundo hijo.
- **Permiso y Stop.** La tarjeta de una tool del hijo es la del chat, y dice
  que la pide un subagente; las de dos hijos a la vez se piden de a una. El
  Stop del turno corta a los hijos, y la fila de delegate queda cancelada.
- **Con qué modelo.** El del agente, salvo que en Settings (tarjeta
  «Subagents», documento `subagentes`) se elija otro para todos. Lo resuelve
  `destinoDeSubagentes` en `chat.cjs`, que también dice por qué no puede (sin
  llave, modelo que ya no está, modelo sin tools).
- **No vino de NeonCode:** el recall de memorias con el brief, el latido para
  corridas sin ventana, el deshacer del turno. El uso de tokens del hijo no se
  suma al del turno: solo figura en el informe.

## La memoria

Desde la 0.15.0. Lo que la app recuerda del usuario de un chat a otro, y de un
agente a otro: es UNA para toda la app. Está en `main/memoria.cjs` (no en
`main/tools/`: también la ven los agentes sin ninguna tool) y sus dos tools,
en `main/tools/memoria.cjs`. Viene de la memoria de NeonCode 1.11.3, sin su
recuerdo automático por similitud (embeddings): acá el agente ve la lista y
decide qué leer.

- **Dos cosas.** El Core («About you» en la vista): un texto corto del
  usuario, que entra ENTERO al contexto (tope 4000 caracteres). Y la lista:
  recuerdos de UNA línea (tope 300), cada uno con un `detalle` opcional que NO
  entra al contexto. La lista entra entera, como un índice (tope 8000).
- **Las tools.** `remember({ fact, detail?, core? })` anota (con `core: true`,
  una línea al final del Core: raro). `recall({ id | query })` lee el detalle
  de una entrada o busca por palabras en todas; es de lectura (no gasta
  presupuesto). El agente no edita ni borra: eso es del usuario, en la vista.
  Un subagente no tiene `remember` (no está escuchando al usuario).
- **Quién la ve.** El agente que tiene prendido su grupo Memory. Prendido,
  además de las tools, su system lleva el bloque (`## Core memory` y
  `## Memory`, con los títulos de NeonCode), antes del protocolo de tools. Con
  un modelo que no acepta tools, el bloque va con las instrucciones. Lo decide
  `conMemoria` en `renderer/datos.js` y lo arma `chat.cjs`, una vez por turno.
  El contenido viaja al proveedor de ese agente: la vista lo dice.
- **Pasado el tope** quedan afuera las entradas MÁS VIEJAS, el bloque dice
  cuántas, `remember` se lo avisa al agente y la vista al usuario. (En NeonCode
  quedaba afuera lo más nuevo, sin aviso: lo tapaba el recuerdo por similitud.)
- **No se anota dos veces lo mismo** (sin mirar mayúsculas ni el punto final).
- **Dónde se guarda.** En el documento `_memoria` del store del núcleo, que la
  interfaz no puede leer: el único que escribe es el proceso principal, y la
  vista pide cada cambio por su canal (`memoria:leer|core|agregar|editar|borrar`;
  el aviso es `memoria:evento`). La lista se cambia de a una entrada. El Core
  es un texto y se guarda entero: va con la `base` con la que se abrió, y lo
  que un agente le agregó mientras tanto se conserva (el cuidado de NeonCode).
- **No vino:** el recuerdo por similitud, los embeddings y su motor local.

## Las skills

Desde la 0.16.0. Procedimientos que el usuario les deja a sus agentes: un
nombre, una línea que dice cuándo usarla y las instrucciones en markdown. Son
unas para toda la app. Están en `main/skills.cjs` y sus dos tools, en
`main/tools/skills.cjs`. Es el mismo mecanismo que la memoria: un índice en
el contexto y el cuerpo a pedido.

- **Las tools.** `skill({ name })` carga una (sin nombre, las lista); es de
  lectura. `create_skill({ name, description, body })` PROPONE una, o un
  cambio a una que existe.
- **Lo que escribe un agente no queda en uso.** Es una propuesta: no entra al
  índice ni se puede cargar hasta que el usuario la aprueba en la vista Skills
  (le llega un aviso que lo lleva ahí). Si la skill ya existía, la versión
  vigente sigue en uso mientras tanto, y la revisión muestra qué cambia.
  Aprobar, descartar, apagar y borrar son canales de la vista: no hay tool que
  llegue a eso. Un subagente carga skills pero no las propone.
- **Quién las ve.** El agente con su grupo Skills prendido: su system lleva el
  índice (`## Skills`, una línea por skill viva, tope 4000 caracteres; lo que
  no entra se dice y se lista con la tool). Sin tools no hay índice: no habría
  cómo leer el cuerpo.
- **Lo que devuelve `skill` se sigue.** El protocolo dice que lo que devuelve
  una tool son datos y no instrucciones; para `skill` hay una excepción
  escrita ahí mismo (es un procedimiento que el usuario escribió o aprobó), y
  el resultado lo dice en su primer renglón.
- **Importar.** La vista lee un `.md` con frontmatter `name` y `description`
  (el formato de las skills de Claude Code) y abre el formulario lleno; no
  guarda hasta que el usuario lo mira.
- **Dónde se guardan.** En el documento `_skills` del store del núcleo, que la
  interfaz no puede leer (canales `skills:leer|guardar|activar|borrar|revisar|
  aprobar|descartar|de-md`; el aviso es `skills:evento`).
- **No vino de NeonCode:** las skills de CÓDIGO (un `.js` que el modelo
  escribía y la app ejecutaba adentro de su proceso principal, con todos los
  permisos de Node). Para ejecutar código un agente tiene `run_code` y los
  comandos, que pasan por la tarjeta de permiso; una skill puede decirle qué
  correr. Tampoco vino que cada skill sea una tool propia (`skill_<nombre>`,
  con la lista de tools cambiando a mitad de un turno) ni `list_skills`.

## La terminal del panel no es una tool

Desde la 0.14.0 hay una terminal al lado de la conversación (`main/terminal.cjs`,
`renderer/terminal.js`): una shell viva del usuario, sin tarjeta de permiso, sin
guardas y sin tiempo límite. **Ninguna tool está registrada contra ese módulo**
(lo cuida `tools/test-blackcode-terminal.mjs`), y así tiene que seguir: para
que el agente corra un comando están `shell_exec`, `cmd_exec` y los jobs, que
sí pasan por el permiso. Lo único que comparten es la carpeta de trabajo: la
shell del panel abre donde están parados los agentes.

## Lo que todavía no vino

- El diario para deshacer lo que escribió una tool (los ganchos están en
  `fs.cjs`, sin nada enchufado).
- Mandar un mensaje a mitad del turno (steer).
- Búsqueda en chats.
- MCP, tareas programadas.
- Dónde guardar secretos para `http_request` (`{{secret:NOMBRE}}`): un pedido
  con un secreto falla diciendo que no está.
- Con qué busca `web_search` se elige en Settings (tarjeta «Web search», desde
  la 0.12.2): DuckDuckGo sin llave, o Tavily o Brave con la suya, guardada
  cifrada (`main/llave.cjs`). El elegido está en el documento `busqueda`, que
  lee `chat.cjs`. De fábrica es DuckDuckGo: desde la 0.7.4 lee su
  página de resultados web (no es una API: si cambian el HTML deja de
  encontrar resultados, o pueden pedir una comprobación humana si se busca
  mucho), con su API de respuestas instantáneas de segundo intento.
- La lista que devuelve `web_search` (desde la 0.12.3): un primer renglón que
  dice de dónde salió (`Web results from Tavily:`) y uno por resultado, con la
  fecha si el buscador la manda. Entra en 4000 caracteres repartiendo el
  espacio: los fragmentos cortos van enteros y los largos se recortan. Antes
  se cortaba en 2000 por renglones enteros, y con los fragmentos largos de
  Tavily llegaba un solo resultado. Un fragmento que es el código de la página
  (JSON o HTML) se cambia por `(no readable excerpt)`. Desde la 0.12.4 los
  títulos y fragmentos pasan por `aTexto`: sin entidades y sin etiquetas de
  HTML conocidas.
- `recency` (0.12.4) es un argumento propio de BlackCode, no de NeonCode:
  `day`, `week`, `month` o `year`. Viaja como `time_range` a Tavily, como
  `freshness` a Brave y como `df` a DuckDuckGo. A Tavily además se le pide
  `include_published_date` (una opción suya en beta: si rechaza el pedido con
  un 400 o un 422, se reintenta sin ella). La definición de `web_search` en
  `defs.cjs` está editada a mano: si se vuelven a generar las definiciones
  desde NeonCode, hay que volver a ponerle `recency`.
- Esos (la búsqueda sin llave, la lista y lo reciente) son los únicos cambios
  hechos sobre el código portado de `web_search`. Ninguno se probó contra
  Tavily ni Brave desde las pruebas: lo confirma Fran usándolos.

## Defectos conocidos que vinieron con el código

Se portaron sin tocar, para no mezclar un port con arreglos. Están anotados
para arreglarlos de a uno, con su prueba:

- `cmd_exec` rompe los comandos con comillas dobles, y devuelve mal los acentos
  de los comandos internos de cmd. PowerShell no tiene ninguno de los dos.
- `shell_exec` corre PowerShell con el perfil del usuario: más lento, y lo que
  el perfil imprima cae en el resultado.
- `fs_edit` puede dañar un archivo que no sea UTF-8.
- `fs_read` lee el archivo entero antes de recortar, y descarta sin avisar las
  rutas después de la décima.
- Una expresión regular inválida en `code_search` devuelve un volcado de error
  en vez de un mensaje.
- `fetch` y `http_request` pueden alcanzar direcciones locales y de la red de
  la casa.
- Un secreto de `http_request` no está atado a un sitio: el modelo no lo ve,
  pero puede mandarlo a cualquier dirección.
- Un job cuyo proceso de arranque termina dejando hijos vivos (un `start` que
  lanza otra cosa y vuelve) figura como terminado y sus hijos quedan huérfanos:
  `job_kill` ya no los alcanza.
- El `until` de `job_output` es una expresión regular del modelo que se evalúa
  en el proceso principal: una mal hecha puede colgar la app.
- `job_kill` sin `id` contesta que no existe el job «undefined».
- `run_code` con Python devuelve mal los acentos de lo que el fragmento
  imprime, hereda el entorno de la app, y un Stop mientras arma el entorno
  virtual o instala un paquete se informa como otro error.
- `os_open` deja abrir `.html`, `.svg` y documentos de Office, que pueden
  llevar código.
- `db_query` y `sqlite_query` corren en el proceso principal y no se pueden
  frenar: una consulta larga congela la app hasta que termina.
- `screen_capture` de una ventana puede informar un alto algo menor que el de
  la ventana (Windows no cuenta la barra de título en la miniatura).
- El bloque `## Open canvases` del system prompt le dice al modelo que revise
  con `read` y después `update` con el contenido entero, cuando la tool y su
  guía mandan a `edit` por fragmentos.
- Un canvas suelto (de un chat borrado) se puede leer y editar desde cualquier
  chat, aunque el texto de `list` diga que solo andan los del chat.
- La papelera del canvas se purga solo al abrir la base: con la app abierta
  más de una semana, lo vencido sigue restaurable.
- Las listas del canvas cortan en silencio (50 por chat, 300 en la biblioteca,
  100 en la papelera).
- Exportar un canvas saca los acentos del nombre del archivo («Título» sale
  `T_tulo.md`).
- `notepad_write` con `move` y sin `folder` saca la nota de su carpeta en
  silencio, en vez de dar un error.
- La fecha de una nota que lee el modelo está en UTC: de noche puede figurar
  con la de mañana.
- `notepad` corta su respuesta a 12.000 caracteres y puede dejar notas sin su
  id, y no ve más allá de las 500 más recientes.
- Guardar o fijar una nota que ya no existe contesta que anduvo.
- Las tools del navegador no miran el Stop: una espera de `wait_for` (10 s),
  de carga (8 s) o del panel (3 s) sigue hasta terminar.
- `browser_type` y `browser_upload` validan sus argumentos después de abrir el
  panel: una llamada inválida igual lo abre.
- `browser_navigate` con `tab` y `new_tab` juntos ignora `new_tab` sin decirlo.
- Guardar un favorito no espera ni atrapa la escritura: si falla, contesta que
  anduvo.
- La capa del navegador y sus ventanas de login tienen el fondo de NeonCode
  (`#0d0d11`), no el de la piel.

## Cómo se prueba

- `tools/test-blackcode-tools-fs.mjs`, `-shell.mjs`, `-web.mjs`, `-jobs.mjs`: las
  pruebas de NeonCode de cada familia, corriendo contra los módulos de BlackCode.
- `-code.mjs`, `-sqlite.mjs`, `-captura.mjs`: nuevas, porque allá esas tools
  no tenían pruebas. La de capturas usa pantallas y ventanas de mentira.
- `-canvas.mjs`: las de NeonCode más el cableado de BlackCode, sobre una base
  descartable.
- `-notas.mjs`: las de NeonCode más el cableado, sobre una base descartable.
- `-browser.mjs`: las de NeonCode sobre un Electron de mentira (no abre
  ninguna ventana), más los runners y los canales de BlackCode. Las que allá miraban
  la interfaz de NeonCode no vinieron: la de BlackCode la prueba el humo.
- `tools/test-blackcode-tools-loop.mjs`: los dos loops contra un servidor local que
  hace de las dos APIs. Mira qué pide cada ronda y qué vuelve, también las
  imágenes de una captura.
- El humo (`tools/smoke-blackcode.js`): con el proveedor de mentira, un mensaje que
  trae un renglón `TOOLS: [...]` hace que se pidan esas llamadas por el motor
  de verdad, sobre una carpeta descartable. Recorre el permiso, el rechazo,
  dos rondas, código, la base propia, un job que se lee y se mata, dos
  capturas, los argumentos malos y el modo automático. En el humo `os_open`
  anota lo que habría abierto en vez de abrirlo, y la pantalla que se captura
  es un degradé: no se fotografía el escritorio.

- El humo en modo real (`tools/smoke-blackcode-real.mjs`): BlackCode sin el proveedor de
  mentira, con las dos APIs reemplazadas por un servidor local. Mira qué viaja
  de verdad en el pedido de un agente con tools (las tools, el protocolo) y
  que una llamada corra y vuelva, con Anthropic y con Venice.

Ninguna toca la red ni gasta un token. Lo que no está probado es un modelo de
verdad pidiendo tools, ni un modelo de Venice recibiendo una imagen.

## Sumar una tool

1. Su definición en `defs.cjs` (y en el grupo que corresponda). El guion del
   humo lista los grupos: hay que sumarla ahí también.
2. Su runner, con el contrato que dice `base.cjs`: recibe `(run, args)`,
   avisa con `run.notify('tool:activity', …)` antes de actuar y devuelve el
   texto que lee el modelo.
3. Registrarla en `index.cjs`.
4. Si es de solo lectura, sumarla a `READ_ROUND_TOOLS` y, si repetirla da
   siempre lo mismo, a `IDEMPOTENT_TOOLS` (las dos en `motor.cjs`).
5. Su línea en `toolGuidance` (`guardas.cjs`) y cómo se resume en el chip
   (`argsDigest`, en `motor.cjs`).
6. Su ícono en `renderer/iconos-tools.js` (el mapa `DE_TOOL`). Sin uno, la
   fila lleva la llave fija.
