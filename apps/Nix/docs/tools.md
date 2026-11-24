# Las tools de Nix

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
| `index.cjs` | Arma todo y es lo único que conoce el chat |

Los loops de cada proveedor están en `main/anthropic.cjs` y `main/venice.cjs`.
Son nuevos: se escribieron para Nix siguiendo las reglas de los de NeonCode y la
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
| Desktop | `os_open` |
| Screen | `screen_capture` |

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

| | Qué hace | En Nix |
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
`%APPDATA%\Nix\tools`.

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

## Lo que todavía no vino

- El diario para deshacer lo que escribió una tool (los ganchos están en
  `fs.cjs`, sin nada enchufado).
- Mandar un mensaje a mitad del turno (steer).
- Canvas, notepad, memoria, búsqueda en chats.
- Subagentes, MCP, skills, navegador, tareas programadas.
- Dónde guardar secretos para `http_request` (`{{secret:NOMBRE}}`) y la llave
  de Tavily o Brave para `web_search`. Sin eso, la búsqueda usa DuckDuckGo y un
  pedido con un secreto falla diciendo que no está.

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

## Cómo se prueba

- `tools/test-nix-tools-fs.mjs`, `-shell.mjs`, `-web.mjs`, `-jobs.mjs`: las
  pruebas de NeonCode de cada familia, corriendo contra los módulos de Nix.
- `-code.mjs`, `-sqlite.mjs`, `-captura.mjs`: nuevas, porque allá esas tools
  no tenían pruebas. La de capturas usa pantallas y ventanas de mentira.
- `tools/test-nix-tools-loop.mjs`: los dos loops contra un servidor local que
  hace de las dos APIs. Mira qué pide cada ronda y qué vuelve, también las
  imágenes de una captura.
- El humo (`tools/smoke-nix.js`): con el proveedor de mentira, un mensaje que
  trae un renglón `TOOLS: [...]` hace que se pidan esas llamadas por el motor
  de verdad, sobre una carpeta descartable. Recorre el permiso, el rechazo,
  dos rondas, código, la base propia, un job que se lee y se mata, dos
  capturas, los argumentos malos y el modo automático. En el humo `os_open`
  anota lo que habría abierto en vez de abrirlo, y la pantalla que se captura
  es un degradé: no se fotografía el escritorio.

- El humo en modo real (`tools/smoke-nix-real.mjs`): Nix sin el proveedor de
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
