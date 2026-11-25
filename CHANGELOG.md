# Changelog

## BlackCode 0.18.0 (2026-11-25)

- **Scrollbars flotantes en las páginas del navegador**, como en Prism: un hilo
  que va encima de la página, aparece al mover la rueda y se ensancha al
  pararse arriba. La clásica de Chromium, con sus flechas, quedaba pegada al
  borde y las esquinas redondeadas del panel se la comían. La app instalada
  se relanza sola una vez al abrir para prenderlas (unos 0,2 s).
- **Historial en el navegador.** El reloj de la barra abre una ventana con las
  páginas por las que se anduvo, agrupadas por día, con buscador. Una entrada
  por dirección: volver a una página la sube. Entran también las que abrió un
  agente. Se saca una, o se vacía entero (pregunta antes). Ninguna tool lo lee.
- **La estrella de los marcadores**: en una página ya guardada se rellena, y
  nada más. El botón ya no queda remarcado.
- **El ícono de una tool que está corriendo se queda quieto**, en blanco. Lo
  que late es la lucecita de «Thinking».
- Íconos de NeonCode: el canvas es la grilla de cuatro cuadrados (también en el
  botón de «All canvases») y la memoria es el chip con el cuadrado adentro.

## BlackCode 0.17.0 (2026-11-24)

- **Cada chat tiene su carpeta de trabajo, y se ve.** Debajo del campo para
  escribir hay un botón con la carpeta donde está parado ese chat: ahí corren
  los comandos de su agente. Su menú deja elegir otra, abrirla en el
  Explorador, copiar la ruta o volver a la de inicio.
- Si un agente se mueve con `cd`, se mueve ese chat y ningún otro. Antes había
  una sola carpeta para toda la app, que no se mostraba: un agente terminaba
  parado donde lo había dejado otro.
- **Carpeta de inicio**, en Settings: donde arranca un chat nuevo. Quien
  actualiza arranca con la última carpeta que usó la app.
- Si la carpeta de un chat ya no existe, el botón lo avisa y el próximo
  mensaje usa la de inicio.
- La terminal abre en la carpeta del chat que se está viendo; reiniciarla la
  lleva a la del chat que se vea en ese momento.

## BlackCode 0.16.0 (2026-11-24)

- **Skills.** Procedimientos que el usuario les deja a sus agentes: cómo
  quiere un informe, los pasos para publicar una app. Vista nueva, Skills,
  para escribirlas, importarlas de un `.md` (el formato de las skills de
  Claude Code), cambiarlas, apagarlas y borrarlas.
- El agente con el grupo Skills prendido ve la lista en cada chat (el nombre
  y cuándo usarla) y carga las instrucciones de la que le sirve con la tool
  `skill`. Los que tenían todas las tools lo reciben prendido.
- **Lo que escribe un agente no queda en uso.** Con `create_skill` propone
  una skill, o un cambio a una que existe; el usuario recibe un aviso, la
  revisa (un cambio se ve con su diff) y la aprueba o la descarta. Mientras
  tanto la versión vigente sigue en uso. El agente no aprueba, apaga ni borra.
- Vienen de las skills de NeonCode 1.11.3, pero solo las de instrucciones. No
  vinieron las de código (un `.js` escrito por el modelo que corría adentro
  de la app con todos los permisos): para ejecutar código están `run_code` y
  los comandos, que piden permiso.
- Son 32 tools en 13 grupos.

## BlackCode 0.15.0 (2026-11-24)

- **Memoria.** Lo que la app recuerda del usuario de un chat a otro, y de un
  agente a otro. Vista nueva, Memory, con dos partes:
  - «About you»: un texto corto que va siempre al contexto de cada chat. Se
    guarda solo.
  - La lista: recuerdos de una línea que anotan los agentes (tool `remember`)
    o el usuario a mano. Cada uno puede llevar un detalle más largo, que no
    ocupa contexto: el agente lo lee cuando lo necesita (tool `recall`, que
    también busca por palabras).
- La ve el agente que tiene prendido su grupo Memory (en el menú de tools de
  la conversación), también si su modelo no acepta tools. Los que tenían todas
  las tools lo reciben prendido. Lo que hay en la memoria viaja al proveedor
  de ese agente con cada mensaje.
- Viene de la memoria de NeonCode 1.11.3, sin su recuerdo automático por
  similitud ni su modelo de embeddings: acá el agente ve la lista entera y
  decide qué leer. Tres cosas se hicieron distinto: pasado el tope quedan
  afuera las entradas más viejas (y se avisa), no se anota dos veces lo
  mismo, y el agente no puede borrar ni cambiar lo anotado.
- Son 30 tools en 12 grupos.

## BlackCode 0.14.2 (2026-11-24)

- **Ícono nuevo: la «Red hexagonal».** Seis agentes en los vértices de un
  hexágono, todos conectados al núcleo. Fran la eligió entre las variantes que
  armó con otro agente (`S:\mockups\daimon\variantes-hex-red.html`), y entre
  tres maneras de pintarla: quedó en el metal que ya tenía el ícono, con el
  núcleo blanco. Reemplaza al «Cubo». Es de líneas finas: en los tamaños
  chicos ningún trazo baja de un píxel ni un nodo de dos.

## BlackCode 0.14.1 (2026-11-24)

- **El navegador ya no cambia de color al estirarlo.** Estirado llevaba un
  fondo opaco para tapar la conversación, y pasaba de vidrio gris a casi
  negro. Ahora es el mismo vidrio que en el ancho de siempre (y que el canvas
  y la terminal): lo que se hace es recortar la conversación donde el panel
  la pisa (`clip-path`, que no remaqueta), así debajo queda la hoja. Al abrir
  y al cerrar, el recorte entra y sale con el panel.
- **En la terminal el texto ya no toca la barra de scroll.** xterm se medía
  contra una caja con padding y se pasaba de ancho: el texto quedaba debajo
  de la barra. Ahora se abre en una caja sin padding y deja una columna de
  aire antes de la barra.

## BlackCode 0.14.0 (2026-11-24) · núcleo 0.18.0

- **Terminal.** Un panel nuevo al lado de la conversación con una shell de
  verdad: PowerShell 7 con el profile del usuario (5.1 si no está instalado),
  en la carpeta donde trabajan las tools. Se abre con su botón o con Ctrl+T.
  El cursor es un bloque, del blanco de la app. Cerrar el panel no mata la
  shell; se reinicia con su botón. Ctrl+C copia si hay algo marcado y Ctrl+V
  pega. Viene de NeonCode 1.11.3 (`terminal.js`), con `@lydell/node-pty` y
  xterm 6.
- La terminal es del usuario: ninguna tool del agente llega a ella
  (`main/terminal.cjs` dice por qué, y un test lo cuida).
- xterm viaja adaptado a la CSP de la app en vez de aflojarla
  (`scripts/vendor-xterm.mjs`): los `<style>` que llena a mano pasan a ser
  hojas construidas y el color de 24 bits se pone por CSSOM.
- **El navegador se estira.** Una manija en su borde izquierdo lo agranda por
  encima de la conversación, sin empujarla, hasta dejar 120 px de chat a la
  vista. Doble clic (o Home) vuelve al ancho de siempre; con las flechas se
  mueve desde el teclado. El ancho dura la sesión. Como en NeonCode.
- **Canvas.** Lo que sube por debajo del título ahora se esfuma (se cortaba al
  aire). La tira de tarjetas se esfuma del lado que recorta, se mueve con la
  rueda y trae sola a la vista la tarjeta del canvas que se abre.
- **Los chats largos ya no frenan la app.** Medido con 700 mensajes:
  - Cada fila de tool que entraba congelaba la ventana (una tarea de 7,5 s):
    la lista hacía «viajar» a todos los mensajes. Era del núcleo (ver abajo).
    Un turno con seis rondas de tools pasó de 17 s a 5,4 s, lo mismo que en
    un chat corto.
  - Los mensajes fuera de la vista no se maquetan ni se pintan
    (`content-visibility`): teclear pasó de 25 ms a 5 ms por tecla, abrir el
    chat de 310 ms a 100 ms, y el texto que llega vuelve a ir a 60 cuadros.
  - El chat se guarda entero a lo sumo cada segundo y medio durante un turno,
    no con cada tool: con cien capturas (30 MB) cada guardado frenaba al
    proceso principal.
- **Núcleo 0.18.0:**
  - `reconcile` (listas): el viaje se mide contra el contenedor y no contra
    la ventana (un cambio de scroll ya no parece un movimiento de todos), se
    mide todo antes de animar (antes, una maquetación por fila) y lo que está
    fuera de la ventana no viaja. `flip` también mide antes de animar.
  - `.rad-scroll-x`: el esfumado del scroll, de costado (`at-start` /
    `at-end`, `data-rad-line="start|end|both"`). `wireScroll` lo reconoce.
- El humo de BlackCode pasa a tener 8 minutos por pasada.

## BlackCode 0.13.0 (2026-11-24)

- **Subagentes.** Tool nueva, `delegate` (grupo Subagents): el agente le pasa
  un trabajo a un subagente, una copia suya que arranca con el contexto vacío,
  trabaja con sus tools y le devuelve solo su informe. Lo que el subagente leyó
  no ocupa el contexto del agente. Viene de NeonCode 1.11.3, con sus textos.
- Hasta cuatro a la vez en una llamada. Solo miran (leer, buscar, la web, la
  pestaña abierta), salvo que el agente pida acceso completo; no pueden lanzar
  subagentes propios, y los que corren juntos no actúan en el navegador.
- En el chat, las tools de cada subagente cuelgan debajo de la fila de
  `delegate`, numeradas cuando son varios; la fila se abre para leer el
  informe. Lo que corrió un subagente no vuelve al modelo como si lo hubiera
  corrido el agente.
- La tarjeta de permiso dice cuándo la pide un subagente, y las de dos a la
  vez se piden de a una. El Stop los corta.
- Settings › Subagents elige con qué modelo corren: el del agente (de fábrica)
  u otro para todos, por ejemplo uno más barato.
- Son 28 tools en 11 grupos; los agentes que tenían todas reciben sola la
  nueva.
- El humo de BlackCode pasa a tener 6 minutos por pasada.

## BlackCode 0.12.4 (2026-11-24)

- **Los resultados de `web_search` salen limpios.** Un fragmento que traía el
  HTML de la página escapado (`&lt;div class="page"&gt;`) o etiquetas sueltas
  (`C<sub>max</sub>`) ahora llega como texto: sin entidades y sin etiquetas.
  Lo que no es una etiqueta («a < b») no se toca.
- **Fechas con Tavily.** Se le pide la fecha de publicación de cada resultado
  (antes solo la mandaba en búsquedas de noticias) y va al lado del título.
- **Solo lo reciente.** `web_search` gana un argumento, `recency` (día,
  semana, mes o año), que cada buscador recibe a su manera: `time_range` en
  Tavily, `freshness` en Brave, `df` en DuckDuckGo. La lista dice el plazo
  («Web results from Tavily (past week):»). Con un plazo pedido, DuckDuckGo
  no cae a sus respuestas instantáneas, que no tienen fecha.

## BlackCode 0.12.3 (2026-11-24)

- **El ícono pasa a metal.** El Cubo es el mismo dibujo, pero el trazo ya no es
  blanco: lleva el degradé gris del hexágono de UmbroSys (gris arriba, casi
  blanco abajo) y el resplandor bajó a menos de la mitad. Combina mejor con la
  piel mono de Rad.
- `tools/icon-kit.mjs` gana `gradientStops`, un degradé de varias paradas.
- **`web_search` trae todos los resultados que se le piden.** Con Tavily se
  pedían 5 y llegaba 1: la lista se cortaba en 2000 caracteres por renglones
  enteros, y con fragmentos largos solo entraba el primero. Ahora entra en
  4000 y el espacio se reparte: los fragmentos cortos van enteros y los largos
  se recortan hasta que entren todos.
- La lista dice de dónde salió (`Web results from Tavily:`) y cada resultado
  lleva su fecha cuando el buscador la manda.
- Un fragmento que es el código de la página y no su texto (pasó con una
  documentación en Tavily) se cambia por `(no readable excerpt)`.
- Los resultados de Brave salen sin sus etiquetas `<strong>`.

## BlackCode 0.12.2 (2026-11-24)

- **Settings elige con qué buscan los agentes.** Una tarjeta nueva, «Web
  search», con un selector entre DuckDuckGo (sin llave, el de fábrica), Tavily
  y Brave, y debajo la llave de cada uno de los dos que la piden. Se pueden
  cargar las dos y cambiar de uno a otro. Las llaves se guardan cifradas, como
  las de los modelos, y nunca llegan a la interfaz.
- Tavily y Brave ya estaban en la tool `web_search` desde el port de NeonCode,
  pero la app no tenía dónde elegirlos ni dónde cargar su llave: siempre caía
  en DuckDuckGo.
- Si se elige un buscador que pide llave y no la tiene, la tarjeta lo avisa y
  la tool falla diciendo qué falta, sin salir a la red.
- Las llaves de los buscadores no se comprueban al guardarlas: ninguno de los
  dos tiene un pedido gratis que diga si la llave sirve.

## BlackCode 0.12.1 (2026-11-24)

- **Ícono nuevo: el Cubo.** Un hexágono con sus tres aristas de adentro: un
  cubo visto de punta. Fran lo eligió para el nombre nuevo; es la candidata 12
  de la misma hoja en que había elegido el Radar, con el mismo oficio (el de
  NTX: baldosa negra a sangre, tinta blanca de punta redonda, resplandor en
  dos pasadas) y el mismo dibujo exacto en todos los tamaños, de 16 a 1024.
- `tools/icon-kit.mjs` gana `sdSegment`: un segmento de trazo con las puntas
  redondas; varios que comparten una punta dan una esquina redonda.

## BlackCode 0.12.0 (2026-11-24)

- **Adjuntos en los mensajes.** Imágenes y archivos de texto, por tres
  caminos: el botón **+** a la izquierda del redactor (o Ctrl+U), pegando
  (una captura del portapapeles, o archivos copiados) y arrastrando y soltando
  sobre la conversación. Lo adjuntado se ve arriba del texto, como miniaturas
  y chips con su ×; un clic en una miniatura la muestra entera.
- Son los adjuntos de NeonCode, con sus números: hasta 4 imágenes y 6 archivos
  de texto por mensaje, 256 KB por archivo. Una imagen se achica antes de
  guardarla (lado mayor 1568 px, en PNG; en JPEG solo si pesa demasiado). Un
  archivo de texto viaja antepuesto al mensaje, entre `<file name="…">` y
  `</file>`. Un PDF o un binario se rechazan, y se dice por qué.
- Al modelo le llegan como imágenes de verdad: bloques de imagen en Anthropic,
  partes `image_url` en Venice. Un mensaje puede ser solo una imagen.
- **Un modelo que no ve no las recibe** (en NeonCode viajaban igual y el
  proveedor rebotaba el pedido entero): se avisa antes de mandar, la imagen
  queda en el chat y al modelo se le dice que había una.
- Con el navegador abierto, el **+** ofrece además adjuntar una captura de la
  página que se está viendo.
- Todo se lee en la interfaz, de los archivos que el usuario eligió: el
  proceso principal no abre ninguna ruta por un adjunto. Un archivo soltado
  fuera de la conversación no hace nada.
- Las imágenes quedan guardadas con el chat y se reenvían en cada turno, como
  el resto de la conversación.
- El humo del navegador esperaba mal a la pestaña nueva y a veces fallaba en
  la app empaquetada: ahora espera a que esté activa.

## BlackCode 0.11.0 (2026-11-24)

- **Notas.** Una vista nueva (la pestaña Notes) con la libreta del usuario,
  que el agente también puede leer y escribir. Es el notepad de NeonCode: el
  store y las dos tools (`notepad` para leer y buscar, `notepad_write` para
  crear, corregir, mover, borrar y restaurar) vinieron portados tal cual, con
  sus pruebas y 150 más (260 comprobaciones); la vista se reescribió sobre Rad.
- Una nota es markdown y nada más: su primera línea es el título. Hay carpetas
  planas y un grupo «Unfiled»; las fijadas van arriba; un buscador filtra por
  contenido.
- **Se guarda sola**, un rato después de la última tecla. Los guardados van
  en fila (dos seguidos no duplican la nota) y antes de abrir otra o de irse a
  otra vista se espera al pendiente: no se pierde la última frase.
- **Nadie le pisa el borrador a nadie.** Si el agente cambia la nota abierta y
  no hay cambios sin guardar, se vuelve a leer; si los hay, queda el borrador
  y se avisa.
- Lo que borra el usuario se va del todo (y lo dice antes); lo que borra el
  agente queda una semana en la papelera y el aviso lo trae de vuelta.
- La nota se LEE dibujada (el markdown de la app, con fórmulas) y se EDITA
  como texto. En NeonCode era un editor que hacía las dos cosas a la vez
  (Milkdown), que no vino; tampoco arrastrar una nota a una carpeta, la
  selección múltiple ni «Clear all».
- El adaptador de SQLite ganó `transaction`, que el store de las notas usa
  para que mandar a la papelera, restaurar y borrar una carpeta sean todo o
  nada.
- Las notas viven en `%APPDATA%\BlackCode\tools\notes.db`, una base propia.
  Son 27 tools en 10 grupos; los agentes que tenían todas reciben solas las
  dos nuevas.

## BlackCode 0.10.0, antes Nix (2026-11-24) · núcleo 0.17.0

- **La app pasa a llamarse BlackCode.** Fran quería un nombre más genérico y
  que fuera con su estilo: el paso siguiente de NeonCode. Cambian el nombre a
  la vista, la ventana, el `.exe`, el instalador, la carpeta
  (`apps/BlackCode`), los archivos de pruebas (`tools/smoke-blackcode.*`,
  `tools/test-blackcode-*`), los comandos (`npm run blackcode`,
  `smoke:blackcode`, `pack:blackcode`…) y la variable del proveedor de
  mentira (`BLACKCODE_PROVEEDOR`). El agente de fábrica de una instalación
  nueva también se llama así.
- **No cambia, a propósito:** el `name` del paquete (`daimon`), el `appId`
  (`com.umbrovex.daimon`) y el repo `kiddshady/daimon-releases`, que es por
  donde la app instalada encuentra su actualización; y la partición del
  navegador (`persist:nix-browser`), donde están los inicios de sesión.
- **Los datos vienen enteros.** BlackCode estrena `%APPDATA%\BlackCode` y
  adopta lo de `%APPDATA%\Nix`: los agentes, los chats y las llaves (con la
  clave que las cifra), lo que guardaron las tools (los canvas, la base del
  agente, los favoritos y las pestañas del navegador) y el perfil del
  navegador, con sus inicios de sesión. No viajan los cachés ni el entorno de
  Python de `run_code`, que lleva rutas absolutas adentro y se arma solo de
  nuevo. La carpeta vieja no se toca.
- **Núcleo 0.17.0:** `rad.adoptData(nombre, { also, skip })`. `also` suma
  carpetas de la app vieja además de sus documentos; `skip(ruta)` deja afuera
  lo que no sirve copiar. Antes solo viajaban los documentos y la clave.

## Nix 0.9.0 (2026-11-24)

- **Navegador.** Un navegador de verdad en un panel al lado de la
  conversación (el botón del globo, o Ctrl+B). Es la MISMA pestaña la que usa
  el usuario a mano y la que maneja el agente: lo que uno abre lo ve el otro.
  Hasta cuatro pestañas, atrás, adelante, recargar, barra de direcciones (el
  texto suelto se busca en DuckDuckGo), favoritos y «abrir en tu navegador».
- **Seis tools para el agente** (grupo Browser): `browser_navigate`,
  `browser_read`, `browser_click`, `browser_type`, `browser_press` y
  `browser_upload`. Lee la página como texto más una lista de lo que se
  puede accionar, numerado; actúa sobre un número y vuelve a leer. Si el
  panel está cerrado, lo abre. El modelo sabe qué pestaña tiene el usuario a
  la vista y sus favoritos por nombre («abrí mi Moodle»).
- Es el navegador de NeonCode. Del lado main vino portado tal cual: sus 3000
  líneas (`agent-browser.cjs`, con tres cambiadas), los runners, las pestañas
  y favoritos guardados, y 504 comprobaciones. El panel se reescribió sobre
  Rad.
- **Sesión propia.** Las páginas viven en un perfil aparte del de la app
  (`persist:nix-browser`): los inicios de sesión quedan ahí. Solo abre http y
  https; niega cámara, micrófono, ubicación y notificaciones; cancela las
  descargas; y las páginas no tienen acceso a nada de la app.
- **La página no es parte de la interfaz:** es una capa nativa que se pinta
  encima de la ventana. Por eso, cuando la app pone algo sobre ella (un menú,
  un modal, la tarjeta de permiso de una tool) la capa se apaga y queda una
  foto de la página en su lugar; y aparece recién cuando el panel terminó de
  entrar.
- El navegador y el canvas comparten el mismo lugar: abrir uno cierra el otro.
- Lo que el agente teclea en una página no queda escrito en la fila del chat
  (por ahí pasan contraseñas).
- El humo lo prueba contra una página servida en la misma máquina, sin salir
  a internet. `RAD_SMOKE_TRAZA=1` hace que una excepción del guion diga en qué
  línea fue.
- No vino: ensanchar el panel arrastrando, mandar una captura de la página al
  chat (la app todavía no adjunta imágenes) ni descargas.

## Nix 0.8.0 (2026-11-24)

- **Canvas.** Un panel al lado de la conversación donde el agente deja un
  documento largo o un archivo de código, en vez de volcarlo en el mensaje.
  Es el canvas de NeonCode: la tool (`canvas`: create, read, edit, update,
  delete, list) y su store vinieron portados tal cual, con sus 116 pruebas y
  105 más; el panel, la barra de tarjetas y la biblioteca se reescribieron
  sobre Rad con sus mismas reglas.
- El agente corrige un canvas **por fragmentos** (`edit`), sin reescribirlo
  entero, y cada cambio sube su versión. Un documento se pinta con el markdown
  de la app (fórmulas incluidas); el código, con sus números de línea.
- Se edita a mano (Edit, Ctrl+S para guardar), se copia, se exporta a un
  archivo y se borra. **Nadie le pisa el borrador a nadie:** si el agente
  reescribe el canvas que se está editando, el borrador queda y se avisa; y
  un borrador sin guardar vuelve solo si el panel se cerró al cambiar de chat.
- Lo que borra el usuario se va del todo; lo que borra el agente queda una
  semana en la papelera, y se restaura desde el aviso o desde la biblioteca
  (el botón de la cabecera: todos los canvas de todos los chats, con
  buscador). Borrar un chat no borra sus canvas: quedan sueltos ahí.
- El panel **empuja** a la conversación, no la tapa (52 % del ancho, entre 320
  y 560 px). El hueco se reserva de un paso y lo que se mueve es el panel, con
  transform y opacidad: la conversación no se remaqueta en cada cuadro (el
  humo lo mide: dos anchos, no veinte).
- El cuerpo de un canvas no viaja en la conversación: el agente sabe cuáles
  hay por un bloque en su system prompt y los lee con la tool.
- **Quien tenía todas las tools recibe las nuevas.** Al sumar un grupo (ahora
  Canvas), el agente que tenía todas las de antes lo recibe prendido; el que
  había apagado alguna no cambia.
- Una tool que la app suma lleva su ícono desde antes (el del canvas ya
  estaba). Los canvas se guardan en `%APPDATA%\Nix\tools\canvas.db`.
- No vino: resaltado de sintaxis en el código (la app todavía no lo tiene en
  ningún lado) ni historial de versiones (allá tampoco había).

## Nix 0.7.4 (2026-11-24)

- **LaTeX en las respuestas.** Las fórmulas se dibujan con KaTeX: en bloque
  con `$$…$$` o `\[…\]`, y en línea con `$…$` o `\(…\)`. Viene con mhchem,
  así que `\ce{Fe2O3 + 2Al -> 2Fe + Al2O3}` sale como química. Los
  delimitadores y la forma de encontrar dónde cierra una fórmula son los que
  NeonCode afinó. «Cuesta $5 y $10» sigue siendo plata, un `$` adentro de un
  tramo de código sigue siendo código, y una fórmula que todavía está llegando
  se ve como texto hasta que cierra. Una fórmula ancha se desplaza sola, sin
  ensanchar la conversación.
- KaTeX corre con la CSP estricta de la app (`style-src 'self'`, sin
  `unsafe-inline`): arma nodos, nunca HTML, y `trust` va apagado. Se carga
  con la primera fórmula, no al abrir. Vive copiado en
  `renderer/vendor/katex` (`npm run katex -w daimon` lo vuelve a copiar).
- **`web_search` busca de verdad sin llave.** Fran vio al agente recibir «No
  web results found» para búsquedas con miles de resultados, y un «Unexpected
  end of JSON input». Sin llave, la tool iba a la API de respuestas
  instantáneas de DuckDuckGo, que no es un buscador: solo contesta por cosas
  con ficha propia, y para el resto devuelve vacío. Ahora lee los resultados
  web de DuckDuckGo y deja esa API de segundo intento. Y cuando la búsqueda
  no se pudo hacer, el modelo recibe un error que lo dice, no un «sin
  resultados» que nadie comprobó. Tavily y Brave, con llave, no cambian
  (todavía no hay dónde cargar esa llave en Settings).

## Nix 0.7.3 (2026-11-24)

- **Un agente nuevo nace con todas las tools prendidas** (pedido de Fran). El
  formulario de un agente nuevo trae los siete grupos prendidos, y el agente
  de fábrica también. Los agentes que ya existían no cambian: quedan como
  estaban.
- **Cada tool tiene su ícono**, como en NeonCode: es su mismo sistema, con los
  paths de su `icons.js` y el mapa de qué ícono lleva cada tool (el lápiz
  para escribir y editar, la carpeta para leer, la terminal para los comandos
  y los jobs, el ojo para la pantalla…). Las de una familia lo comparten. Una
  tool sin ícono propio lleva el genérico de siempre, la llave fija, que
  también sigue en el botón de la conversación. Están ya los íconos de las
  tools que todavía no vinieron (canvas, navegador, notas, skills, MCP).
- Varios de esos paths son de Feather Icons (MIT): el aviso viaja en el
  archivo y en `apps/Nix/THIRD-PARTY.md`, que va dentro del instalador.
- El proveedor de mentira contesta lo de siempre cuando el agente tiene tools
  y no se le pide ninguna (antes, una frase corta): ahora todos nacen con
  tools y el humo mide esa respuesta.

## Nix 0.7.2 (2026-11-24)

- **Las tools se prenden desde la conversación.** Arriba a la derecha del
  chat hay un botón que dice cuántas tools lleva el agente («6 tools», o
  «Tools: off») y abre un menú con los siete grupos, para prender y apagar
  cada uno, todos o ninguno. El cambio vale desde el mensaje siguiente.
  Con la 0.7.1 Fran vio «no tools» en sus dos agentes: tenían todos los
  grupos apagados, que es como nacen, y el único interruptor estaba al final
  del formulario del agente, que hay que scrollear para verlo.
- Se comprobó contra la lista pública de Venice que «GLM 5.3 Flash
  Uncensored» declara que acepta tools (y casi todos los demás también): no
  era el modelo.
- El humo prende y apaga tools desde ese menú y manda un pedido que las usa, y
  le prende tools desde el formulario a un agente que ya existía.

## Nix 0.7.1 (2026-11-24)

- **La barra de estado dice cuántas tools lleva el agente** («· 15 tools», o
  «· no tools»). Fran les preguntó a dos agentes si tenían tools y dijeron que
  no: las tools nacen apagadas en cada agente y, desde el chat, no había forma
  de saber si el modelo las estaba recibiendo. La cuenta es la que viaja en el
  pedido: cero si el modelo elegido no las acepta.
- **Humo en modo real** (`npm run smoke:nix:real`, y dentro de `npm run
  smoke`). El humo de siempre corre con el proveedor de mentira, que deja sin
  ejercer lo que une la interfaz con un proveedor de verdad. Este abre Nix sin
  él, con las dos APIs reemplazadas por un servidor local: guarda las llaves,
  manda un mensaje con un agente de Anthropic y otro de Venice que tienen
  todas las tools, y mira que el pedido las lleve con su protocolo, que la
  llamada corra y que su resultado vuelva. No toca la red ni gasta un token.
  Con las tools prendidas, las 18 viajan y corren, también en la app
  empaquetada: el reporte de Fran no se pudo reproducir como un defecto.

## Nix 0.7.0 (2026-11-24)

- **Ocho tools más, y son 18.** Se suman a los grupos que se prenden por
  agente: procesos en segundo plano (`job_start`, `job_output`, `job_kill`,
  en Commands), correr código (`run_code`, en Code), bases SQLite (`db_query`
  y `sqlite_query`, en Databases), abrir cosas (`os_open`, en Desktop) y mirar
  la pantalla (`screen_capture`, en Screen, sola en su grupo).
- **Siguen viniendo de NeonCode, portadas tal cual**, con sus comentarios. Las
  pruebas de los jobs vinieron con el código; las de `run_code`, SQLite y las
  capturas son nuevas, porque allá no tenían (486 comprobaciones entre las
  cuatro familias).
- **Los jobs sobreviven al turno.** Un servidor o un proceso largo queda
  corriendo mientras el chat sigue, se lee y se mata por su id, y el modelo de
  cualquier chat ve en su system prompt los que siguen vivos. Al cerrar Nix se
  matan todos, con su árbol de procesos.
- **`run_code` corre Python o Node** en una carpeta que se conserva de una
  llamada a la otra, con entorno virtual y `pip` a pedido. Las imágenes que
  deja (un gráfico) aparecen en la fila de esa llamada, sin abrirla.
- **SQLite sin módulo nativo.** NeonCode usaba `better-sqlite3`, que hay que
  recompilar con cada Electron; acá es `node:sqlite`, el que viene con Node,
  detrás de un adaptador que le da a las tools lo mismo que tenían.
- **El modelo ve la pantalla.** `screen_capture` saca un monitor o una ventana
  (por título, por el job que la abrió o por pid), y la imagen llega al modelo
  y a la fila del chat: el usuario ve lo mismo que vio el modelo. Con
  Anthropic viaja adentro del resultado de la llamada; con Venice, en un
  mensaje aparte, y solo a los modelos que Venice declara que aceptan
  imágenes (a los demás no se les ofrece la tool).
- **Lo que guardan las tools** (la carpeta de `run_code`, la base del agente)
  queda en `%APPDATA%\Nix\tools`.
- El humo de Nix recorre las tools nuevas con el proveedor de mentira:
  `os_open` anota lo que habría abierto en vez de abrirlo, y la pantalla que
  se captura es un degradé, no el escritorio. Con `RAD_SMOKE_KEEP=1` deja la
  carpeta de datos para mirarla y `RAD_SMOKE_TIMEOUT` estira su tope.
- Los defectos que vinieron con el código están anotados en
  `apps/Nix/docs/tools.md`, sin tocar. Sigue sin probarse con un modelo de
  verdad.

## Nix 0.6.0 (2026-11-23)

- **Tools: un agente puede actuar en la PC.** Diez para empezar, en tres
  grupos que se prenden por agente: archivos (`fs_read`, `fs_write`,
  `fs_edit`, `fs_delete`, `code_search`), comandos (`shell_exec`,
  `cmd_exec`) y web (`fetch`, `web_search`, `http_request`). Un agente sin
  ninguna prendida conversa como siempre.
- **Vienen de NeonCode, portadas tal cual.** El código de cada tool, el
  despachador, el corte de bucles y los textos de guardrail se trajeron de
  NeonCode 1.11.3 sin reescribir, con sus comentarios y sus pruebas (469
  comprobaciones entre las tres familias). Fran aprobó publicarlo. Lo que
  cuenta qué vino y qué no está en `apps/Nix/docs/tools.md`.
- **Un solo registro de lo que corrió, y lo leen tres.** Cada llamada deja
  una fila en la conversación con su estado (corriendo, hecha, fallida,
  rechazada, cancelada o cortada por repetirse), que se abre para ver lo que
  devolvió. Debajo de la respuesta va el contador del turno, también cuando
  no corrió ninguna. Y el modelo recibe ese mismo registro al final de cada
  pedido, que es donde decide.
- **Permiso.** De fábrica, cada llamada muestra una tarjeta con lo que va a
  correr y, si toca un archivo, el diff; se puede aprobar, rechazar o tildar
  «no preguntar más en este chat». En Settings se pasa a modo automático, que
  no pregunta. No hay límite de carpetas ni filtro de comandos: la única
  barrera es esa tarjeta.
- **Los dos proveedores tienen su loop.** El de Anthropic, con su formato; el
  de Venice, con el de OpenAI, para los modelos que Venice declara que aceptan
  tools (los demás conversan, y el formulario del agente lo dice). Un turno
  admite 15 rondas que cambien algo; las de pura lectura no se cobran. Al
  llegar al tope, la última ronda sale sin tools y la app declara el corte.
- **Sin probar con un modelo de verdad.** Todo se probó contra servidores
  locales y el proveedor de mentira, sin gastar un token.
- No vinieron todavía: deshacer, mandar un mensaje a mitad del turno, jobs,
  `run_code`, SQLite, canvas, notas, memoria, subagentes, MCP, skills,
  navegador y tareas programadas. Tampoco el detector de «dije que lo hice»,
  que es la única medida que juzga texto.

## Nix 0.5.0, antes Daimon (2026-11-23)

- **La app pasa a llamarse Nix** (así se llamaba la gatita de Fran). Cambian
  el nombre de la ventana, del ejecutable, del instalador y de los accesos
  directos, los textos de la interfaz, la carpeta del repo (`apps/Nix`) y
  los comandos (`npm run nix`, `smoke:nix`, `shots:nix`, `pack:nix`).
- **Los datos vienen solos.** La carpeta de datos sale del nombre de la app,
  así que Nix estrena una; la primera vez que abre copia de la de Daimon los
  agentes, los chats y las dos llaves de las APIs, que se siguen leyendo sin
  pegarlas de nuevo (lo nuevo del núcleo, abajo). La carpeta vieja no se toca.
- **No cambian** el nombre del paquete (`daimon`), el `appId`
  (`com.umbrovex.daimon`) ni el repo de releases
  (`kiddshady/daimon-releases`): es por donde la Daimon instalada encuentra
  esta versión y se actualiza a Nix sola.
- El agente con que arranca una instalación nueva se llama Nix. El de una
  instalación que ya existía no se toca: es un dato del usuario.

## @rad/core 0.16.0 (2026-11-23)

- **`rad.adoptData()` trae también lo cifrado.** Cuando una app cambia de
  nombre, sus datos se copian de la carpeta vieja, pero lo que había cifrado
  con `safeStorage` (una llave de una API) quedaba ilegible: Chromium cifra
  con una clave maestra que vive en el «Local State» de la carpeta de
  usuario, y la carpeta nueva estrenaba la suya. Ahora, al adoptar, se copia
  también ese archivo, y la app arranca con la misma clave. Solo si la
  carpeta nueva todavía no tiene uno (nunca pisa una clave en uso), y solo
  sirve antes de `app ready`: `adoptData` va arriba de todo en el main, y
  avisa por consola si se la llama tarde. Probado de punta a punta con el
  núcleo de verdad: una app adopta los datos de otra y lee un secreto que la
  otra cifró.


## Daimon 0.4.0 (2026-11-23)

- **Las vistas pasan a la titlebar, como pestañas, y se va el rail** (pedido
  de Fran, como en Umbra). Chat, Agents y Settings son lo primero de la
  barra, alineadas con la hoja; la activa muestra su nombre y las otras el
  ícono, con el nombre en el tooltip. El ancho que ocupaba el rail queda
  para el panel de chats, la conversación y lo que se abra al lado más
  adelante (el canvas).
- **La titlebar ya no dice «Daimon»**: arranca directo con las pestañas. La
  barra de abajo sigue diciendo en qué vista estás.

## @rad/core 0.15.0 · Rad 0.14.0 (2026-11-23)

- **Pestañas de vistas en la titlebar:** `createShell({ nav: 'titlebar' })`.
  Hasta acá las vistas solo podían ir en el rail; ahora también adentro de
  la titlebar, dejándole todo el ancho al escenario. La pestaña activa
  despliega su rótulo (la caja se abre de 0fr a 1fr, sin animar anchos a
  mano) y las demás quedan en el ícono, con el rótulo en el tooltip. Una
  vista sin ícono muestra el rótulo siempre. Las flechas a los lados las
  recorren, y de lo que ocupan no se arrastra la ventana. `nav` vale
  `'rail'` (por defecto), `'titlebar'` o `'none'`; `rail: false` sigue
  andando. Anatomía nueva: `.rad-tabs`, `.rad-tab`, `.rad-tab-label`,
  `.rad-tab-text`.
- **`title: false`** saca el nombre de la app de la titlebar.
- Las tres pieles visten las pestañas (classic 0.5.4, glass 0.1.5, mono
  0.1.3): la activa es la gota de vidrio del rail en glass y mono, y lleva
  el tinte del acento en classic.
- La vitrina (0.14.0) las muestra con `RAD_SHOWCASE_NAV=titlebar`, y el
  humo corre así su segunda pasada con cada piel: que no quede rail, que el
  escenario gane el ancho, que las plegadas midan lo mismo y no dejen ver su
  rótulo, y que el rótulo de la que se elige se despliegue de a poco.

## Daimon 0.3.1 (2026-11-23)

- **El ícono de verdad: el «Radar».** Dos aros cortados en lados opuestos y
  un punto en el centro, una presencia detectada. Lo eligió Fran entre
  diecisiete candidatas, con el oficio del ícono de NTX tal cual: baldosa
  negra con su degradé, tinta blanca de punta redonda y el resplandor en dos
  pasadas. Reemplaza la medialuna provisoria. Es el mismo dibujo, con su
  resplandor, en todos los tamaños del .ico (de 16 a 256) y en el de 1024.
- El kit de íconos (`tools/icon-kit.mjs`) suma lo que hacía falta para
  hornearlo sin dependencias: `rasterizeGlow` (copias desenfocadas del
  dibujo detrás del trazo, con un gaussiano de verdad en chico y tres
  promedios móviles en grande), `sdArc` (un arco de puntas redondas) y
  `gradient` (el color de una capa puede ser un degradé). El ícono de la
  vitrina sale idéntico byte a byte.

## Daimon 0.3.0 (2026-11-23)

- **Daimon se instala y se actualiza sola.** Tiene su repo de releases
  (`kiddshady/daimon-releases`, con el OK de Fran) y el aviso de versión
  nueva del núcleo: no baja nada sola, no dice «estás al día», e instala en
  silencio al tocar Restart (o al cerrar). Hasta acá solo se podía abrir
  desde el repo, con `npm run daimon`.
- **About tiene un botón para buscar una actualización ahora** (pedido de
  Fran: como el de NeonCode). Es un solo botón que cambia de oficio: buscar,
  bajar la que encontró, y reiniciar para instalarla. Al lado dice qué pasó,
  también cuando no hay nada («You’re on the latest version») y cuando no se
  pudo buscar. Mientras busca o baja, la tarjeta muestra el anillo de carga;
  el porcentaje de la descarga se escribe en su lugar, sin relevar el texto,
  y el botón no cambia de ancho con el rótulo. Abierta desde el repo no hay
  de dónde actualizar, y lo dice.
- El humo recorre los estados dándole al módulo los eventos que mandaría el
  núcleo (no se publica nada para probar), y contra la app empaquetada la
  búsqueda le pregunta a GitHub de verdad.

## @rad/core 0.14.0 (2026-11-23)

- **`rad.updates.check()` dice qué encontró.** Devolvía la versión o
  `null`, y con eso un botón «Buscar actualizaciones» no podía distinguir
  «estás al día» de «acá no hay updater» ni de «no se pudo buscar». Ahora
  devuelve `{ supported: false, reason }` fuera de la app instalada
  (`'dev'`, `'portable'`, `'disabled'`, `'missing'`) o
  `{ supported: true, available, version, error }`. Ninguna app usaba lo
  que devolvía: el aviso de `wireUpdates()` va por eventos y no cambia.

## Daimon 0.2.0 (2026-11-23)

- **La interfaz está en inglés.** Todo lo que se lee: las vistas, los
  formularios, los menús, los avisos, los errores de los dos proveedores y
  las notas de los modelos, y también lo que pone el núcleo (los botones de
  la ventana, los de un confirm), con `lang: 'en'`. El código y los
  comentarios siguen en castellano. Un chat todavía sin nombre que se había
  guardado como «Chat nuevo» pasa a «New chat», y la lista de modelos de
  Venice guardada (que traía las notas en castellano) se vuelve a pedir.
- **La fuente de código es Roboto Mono**, la que viaja con Rad: bloques de
  código, ids de modelos, datos. Antes quedaba la Cascadia de la piel.
- **El selector de agente dice solo el nombre**, como un select (pedido de
  Fran, como en Umbra). Antes llevaba debajo el proveedor y el modelo, y un
  modelo de nombre largo («Venice · DeepSeek V4.1 Flash 1017 Uncensored») se
  salía del botón y de la columna. Con qué modelo habla el agente lo dicen
  la cabecera de la conversación y la barra de estado.
- **Un modelo de nombre largo ya no tapa el chevron del select** (el arreglo
  es del núcleo, abajo). Además el formulario del agente es más ancho: los
  modelos de Venice se distinguen por el final del nombre, así que tienen
  que verse enteros.
- Los textos que no entran se cortan con puntos suspensivos en vez de salirse
  de su caja: el título de un chat en la lista (se metía debajo del botón de
  acciones), el de la conversación y su subtítulo, y el nombre y el modelo de
  la tarjeta de un agente. Era el mismo defecto del select.
- El humo comprueba que no quede texto en castellano a la vista ni en los
  rótulos (lo que escribe el guion va en inglés y sin acentos), que la mono
  sea Roboto Mono cargada de verdad, que el selector diga solo el nombre y
  que ningún texto largo se salga de su caja. Cada prueba nueva se vio
  fallar con el código roto.

## @rad/core 0.13.0 · Rad 0.13.0 (2026-11-23)

- **Idioma de los textos del núcleo:** `rad.start({ lang: 'en' })`. El
  núcleo pone pocos textos por su cuenta (los botones de la ventana, los de
  un `confirm`, el aviso de actualización, el placeholder de un select),
  pero una app en inglés no podía mostrarlos en castellano. Sin `lang`
  salen en castellano, como siempre. El renderer lo ve en `rad.lang`, el
  núcleo lo pone en el `lang` del documento, y los textos viven en
  `renderer/strings.js`. Un idioma que no existe frena el arranque.
- **Select: una etiqueta que no entra ya no tapa el chevron.** La celda del
  texto se achicaba con el botón, pero el texto (que no parte renglón) medía
  entero y se salía de la celda, por encima del chevron. Ahora se corta con
  puntos suspensivos, el chevron queda en su lugar, y el botón muestra la
  etiqueta entera en su tooltip (solo cuando está cortada). Fran lo vio en
  Daimon con un modelo de Venice de nombre largo.
- La vitrina (0.13.0) suma en Controles un select en un campo angosto, y el
  humo mide que la etiqueta se corte, que no llegue al chevron y que el
  tooltip la traiga entera; falla con el CSS de antes.

## Daimon 0.1.1 (2026-11-23)

- **La llave de Anthropic se comprueba contra la API, no se adivina.** La
  0.1.0 avisaba «es una llave de usuario: la API la rechaza» mirando cómo
  empezaba la llave, y era falso: la Console crea llaves personales que
  sirven si se las ata a un workspace al crearlas. Fran creó una así, la
  guardó y el aviso seguía. Ahora Daimon le pregunta a la API si la acepta,
  con un pedido que no gasta nada (listar un modelo), al guardarla y al abrir
  Ajustes:
  - mientras pregunta lo dice, la tarjeta muestra el anillo de carga y la
    llave todavía no figura como buena;
  - si la API la acepta, lo dice (y recién ahí el punto va en verde);
  - si la rechaza, dice por qué según lo que contestó la API: no es válida,
    se deshabilitó o venció (401); no está atada a un workspace (400), con la
    indicación de elegirlo al crearla; o no tiene permiso (403). Debajo va lo
    que dijo la API, tal cual;
  - si no se pudo comprobar (sin conexión, o la API anda mal), lo dice sin
    darla por mala, y hay un botón para comprobar de nuevo.
  Lo que la API ya contestó queda en memoria por llave (por su huella, nunca
  la llave) y no se vuelve a preguntar cada vez que se abre Ajustes.
- Ya no se rechaza al pegar lo que no empieza con `sk-ant-`: alcanza con que
  sea un texto largo y sin espacios. Si sirve o no, lo dice la API.
- La llave de Venice no se comprueba: su lista de modelos no pide llave, así
  que no hay un pedido gratis que la pruebe. Figura como guardada.
- El humo recorre cada resultado contra el proveedor simulado (incluida la
  llave «de usuario» que la API acepta, y falla si vuelve el aviso viejo), y
  `test-daimon-provider` prueba la comprobación de verdad contra el servidor
  local: qué pide, qué decide con cada respuesta y que nunca manda un mensaje.

## Daimon 0.1.0 (2026-11-23)

La primera app permanente hecha con Rad (`apps/Daimon`): un chat con IA
donde se arman varios agentes. Es un prototipo angosto, para ver si la idea
convence antes de invertirle más.

- **Agentes.** Cada uno tiene su nombre, su proveedor, su modelo y sus
  instrucciones, y sus propios chats. Se crean, se editan y se borran (el último no: siempre hay
  con quién hablar). Arranca con uno, para escribir sin armar nada.
- **Chats.** Se crean, se renombran y se borran, desde el botón de cada fila
  o con click derecho. Borrar pide confirmación. El título sale del primer
  mensaje hasta que se lo renombra.
- **La conversación.** La respuesta llega de a poco y se puede frenar; lo que
  había llegado queda. Markdown básico (títulos, negrita, cursiva, listas,
  citas, tablas, links y bloques de código con su botón de copiar), armado
  nodo por nodo: lo que escribe el modelo nunca se interpreta como HTML, y
  mientras llega solo se toca el bloque que cambió. Todo el texto se puede
  seleccionar. Enter manda, Shift+Enter baja de renglón.
- **Solo conversa:** sin herramientas. El pedido va en el proceso principal y
  el texto llega al renderer de a poco, por el puente.
- **Dos proveedores, y cada agente elige el suyo.**
  - *Anthropic* (Opus 5.5, Sonnet 5.5, Haiku 5.5 y Fable 5.2), con el SDK
    oficial. Si el modelo declina, la API reintenta sola con otro
    (`fallbacks`), menos en Haiku, que no lo tiene.
  - *Venice*, a pedido de Fran, que tiene tokens ahí. Su API es compatible
    con la de OpenAI y se habla con `fetch`, sin dependencia nueva. La lista
    de modelos no está escrita: se le pide a Venice al guardar la llave y se
    vuelve a pedir cada unas horas (sin llave de Venice, Daimon no llama a
    nadie). El pedido apaga el system prompt que Venice antepone por su
    cuenta, así las instrucciones del agente son las únicas.
  - En el formulario del agente, cada proveedor tiene su select de modelos y
    los dos se relevan en la misma celda.
- **Las llaves,** una por proveedor, se pegan en Ajustes y se guardan
  cifradas con `safeStorage`, en documentos que el renderer no puede leer.
  Nunca quedan en claro: al renderer le llega una pista para reconocerlas. Si
  una no se puede descifrar, dice que hay que pegarla de nuevo en vez de
  darla por buena, y avisa si lo que se pegó es una llave de usuario de
  Anthropic (`sk-ant-usr`), que la API rechaza. Si al agente abierto le falta
  la llave de su proveedor, el chat lo dice arriba del campo para escribir.
- Un documento por chat: abrir la app no lee todas las conversaciones.
- Piel mono, fija. Sin actualizaciones hasta que tenga su repo de releases.
  El ícono es provisorio.
- **Pruebas, sin gastar un token.** El humo (`tools/smoke-daimon.mjs`) corre
  contra un proveedor simulado y mide: crear y editar un agente, crear un
  chat, mandar un mensaje, ver llegar la respuesta de a poco, frenarla,
  cambiar de chat, borrar uno mientras contesta, renombrar, guardar las dos
  llaves (y que no queden en claro en el disco), un agente de Venice con su
  modelo, y que todo siga ahí al reabrir. `tools/test-daimon-provider.mjs`
  prueba los dos proveedores de verdad contra un servidor local que habla el
  protocolo de cada API: qué mandan, cómo leen el streaming (con los eventos
  partidos), cómo frenan y qué dicen cuando algo falla.

## @rad/core 0.12.0 · Rad 0.12.0 (2026-11-23)

Tres piezas que pidió la primera app de verdad. Ninguna cambia una API que
ya existiera.

- **Listas que se ponen al día por clave** (`reconcile()`, en
  `/@core/list.js`). Una lista que ya se ve no se rehace: el item que sigue
  es el mismo nodo y viaja a su lugar, el que se va se esfuma en el suyo
  (fuera del flujo, mientras los demás se acomodan) y el nuevo entra
  fundiéndose cuando el que se iba casi no se ve. El primer llenado no entra
  animado. Un nodo solo se mueve en el DOM si no está donde tiene que estar.
- **Menú contextual** (`contextMenu()`, en `/@core/menu.js`). El click
  derecho abre el menú con la esquina en ese punto, con los items de lo que
  se clickeó (sirve delegado: una vez en la lista). Sin items no abre nada,
  y nunca deja pasar el de Chromium. Desde el teclado sale junto al elemento,
  con el primero activo, y al cerrar el foco vuelve a donde estaba.
  `openMenu()` acepta `at` (un punto o una caja) en vez de `anchor`.
- **Borrar un documento** (`rad.store.remove()` en el main, `removeDoc()` en
  el renderer). Se van el archivo y su `.bak`. Va por la misma cola que los
  guardados: uno que estaba pendiente ya no se escribe, y uno que venía en
  vuelo termina antes y no lo resucita.
- Los documentos con `_` quedan dichos como lo que son: del proceso
  principal. El núcleo guarda ahí el lugar de la ventana y una app puede
  guardar lo que el renderer no tiene que ver.
- La vitrina muestra las listas y el menú contextual en Movimiento, y el
  humo los mide con las tres pieles: el viaje cuadro por cuadro, que la fila
  que se va no salte, que reordenar mueva los nodos en vez de rehacerlos, y
  dónde sale el menú. Con el viaje apagado a propósito, el humo falla.

## @rad/core 0.11.0 · Rad 0.11.0 (2026-11-23)

- **La vitrina pasa a llamarse Rad a secas.** Fran no quería el «Vitrina» en
  el nombre de la app instalada. Cambian el `productName`, el `.exe`
  (`Rad.exe`), el título de la ventana y el instalador
  (`Rad-Setup-<versión>.exe`). El `appId` y el repo de releases son los
  mismos, así que la instalada se actualiza sola. Adentro del repo sigue
  siendo «la vitrina» (`apps/showcase`): es su papel, no su nombre.
- **`rad.adoptData('Nombre viejo')`** (núcleo). La carpeta de datos sale del
  `productName`: una app que cambia de nombre arrancaría de cero. Esto copia
  los datos de la carpeta vieja si la nueva todavía no existe, a un temporal
  que se renombra al final (o queda entera o no queda). No pisa nada, no
  borra la vieja y se puede dejar para siempre. Va antes del primer uso del
  store. Con su prueba en `test-store` (y la prueba falla con el código roto).
- `test-update` acepta `--after "<.exe>"` para cuando la versión nueva le
  cambia el nombre al ejecutable.

## Rad Vitrina 0.10.1 (2026-11-23)

- Sale con @rad/skin-mono 0.1.2: los colores de estado a pleno, el rojo
  hondo en cerrar y en el botón destructivo, y el halo de color en los
  puntos de los toasts.

## @rad/skin-mono 0.1.2 (2026-11-23)

- **El halo de los puntos de un toast, de su color.** El de «sin tipo» es
  blanco, y esa regla les ganaba a las de glass por la capa (no por la
  especificidad): los puntos verde, ámbar y rojo salían con halo blanco, que
  les lavaba el color. Lo vio Fran. Ahora cada uno brilla de lo suyo.

## @rad/skin-mono 0.1.1 (2026-11-23)

- **Los colores de estado, a pleno.** Listo, atención y error eran pasteles
  (`#8fcfab`, `#dfc085`, `#e58e93`) y sobre negro y gris se leían casi blancos:
  Fran los pidió más notorios. Ahora son color de verdad (`#2fc27a`, `#eca21f`,
  `#ef4f58`): en una piel sin color, lo único que lo lleva tiene que verse.
- El rojo que rellena (el botón destructivo y la pastilla de cerrar) es uno
  más hondo, `--skin-danger-fill` (`#c92a35`), con letra clara encima en vez
  de la oscura de glass. El de texto y puntos queda más claro para leerse
  sobre el vidrio (5,6:1 sobre el fondo).

## @rad/core 0.10.0 · Rad Vitrina 0.10.0 (2026-11-23)

- **Botones de ventana en pastilla.** Fran los pidió como los de sus apps de
  Opal: rectángulos redondeados más chicos, separados del canto, en vez del
  bloque que llegaba hasta el borde. El botón sigue ocupando todo el alto y
  llegando a la esquina (con la ventana maximizada, tirar el mouse a la
  esquina sigue cerrando); lo que se pinta es una pastilla adentro.
- Cambio de anatomía para las pieles: el fondo del hover y el rojo de cerrar
  van en `.rad-winbtn::before`, no en el botón. El anillo del teclado también
  va en la pastilla, así no se corta contra el canto de la ventana. Perillas:
  `--rad-a-winbtn-plate` (el alto) y `--rad-a-winbtn-air` (el aire a los lados).
- Classic y glass ya la visten; mono la hereda de glass sin tocar nada.

## @rad/core 0.9.0 · @rad/skin-mono 0.1.0 · Rad Vitrina 0.9.0 (2026-11-23)

- **Mono, una piel nueva.** Glass sin color: vidrio oscuro acromático donde
  toda la luz es blanca (el canto, el foco, el resplandor, el anillo de
  carga). El telón ya no deja pasar color sino claridad. El blanco va en
  líneas y halos, no en superficies: lo prendido (el primario, el switch) es
  vidrio encendido y no un bloque blanco. Los colores de estado se quedan,
  más apagados.
- **Una piel puede heredar de otra** (`extends` en el manifiesto): el núcleo
  sirve la base en `/@base/` y la que hereda la importa entera y pone solo lo
  que cambia. Mono son dos archivos chicos sobre glass, y un arreglo en glass
  le llega sola. El verificador sigue la herencia.
- Glass ya no tiene el color del acento escrito a mano en sus resplandores:
  salen del token, que es lo que deja que otra piel la herede.

## @rad/core 0.8.0 · Rad Vitrina 0.8.0 (2026-11-23)

- **El anillo de carga**, una pieza nueva del núcleo: `setBusy(el, true)` hace
  que una luz con resplandor recorra el reborde de lo que está trabajando.
  Fran la vio en una barra de otra app y quiso tenerla.
- Va a la misma velocidad en todo el recorrido: es un contorno en SVG con
  trazos que avanzan, no un degradado cónico girando (que en algo ancho se
  arrastra por el medio y pega un latigazo en las puntas).
- Todos los anillos van en fase con la hora del documento: dos cosas que
  cargan a la vez giran juntas, y volver a prender uno que se estaba yendo lo
  releva sin salto. Entra y sale fundiéndose, sigue el redondeo de su dueño
  (también en una píldora) y marca `aria-busy`.
- Colores, grosor, resplandor y vuelta son perillas `--rad-a-busy-*`. Glass
  le pone cola violeta y cabeza de hielo.
- En la vitrina: Movimiento → Cargando. En el humo: la luz avanza lo que
  marca su vuelta, los trazos comparten la cabeza, dos anillos van en fase y
  al apagar no queda nada. Esa prueba encontró el primer bug: con un número
  en una punta de la animación y un `calc` en la otra no hay interpolación, y
  la luz quedaba quieta sin dar ningún error.

## Rad Vitrina 0.7.1 (2026-11-23)

- **Se retira la piel cyberpunk.** Fran la probó y el estilo cyberpunk puro no
  le cerró para la interfaz de una app. Quedan classic y glass. El código de
  la piel está en el historial (`ceefd16`), y lo que dejó sigue valiendo: una
  piel puede traer sus propias entradas, y el humo no le exige respiro de
  scrollbar a una piel sin esquinas redondeadas.
- Si la vitrina tenía guardada una piel que ya no existe, abre con classic.

## @rad/skin-cyberpunk 0.1.0 · Rad Vitrina 0.7.0 (2026-11-23)

- **Cyberpunk, la tercera piel.** Neón sobre negro y todo a filo: cian para lo
  principal, magenta para lo que cambia (el foco, la selección, el modal) y
  amarillo para lo clave. Los tres cuadraditos de la titlebar son la firma.
  Bahnschrift para la interfaz, etiquetas en mayúsculas, el radio es un rombo
  y el switch un bloque que cruza.
- Los planos no se separan con sombra sino con una línea de luz, y lo que
  flota resplandece. Los botones van completos y no hay cuadrícula de fondo
  (Fran ya había sacado las dos cosas de este estilo); las líneas de monitor
  van casi invisibles.
- **Entradas propias de una piel**, sin tocar el núcleo: el menú y el tooltip
  se despliegan desde el borde por donde nacen, el toast desde la derecha y
  el modal se enciende como un monitor, desde una raya en el medio.
- El humo ya no le exige respiro de scrollbar a una piel sin esquinas
  redondeadas.

## @rad/core 0.7.1 · Rad Vitrina 0.6.1 (2026-11-23)

- **El respiro de la scrollbar.** En algo que scrollea y tiene las esquinas
  redondeadas, el pulgar llegaba hasta la punta y la curva lo cortaba (Fran lo
  vio en la hoja de glass). El núcleo suma la perilla `--rad-a-scroll-inset`:
  cuánto se separa la pista de las dos puntas. La declara quien redondea y
  vale solo para ese elemento, no para los scrolls de adentro.
- Glass la usa en la vista (la hoja es redonda de los cuatro lados), el menú,
  el modal y el textarea; classic, en el menú, el modal y el textarea.
- El humo comprueba que la pista tome el respiro de su dueño y que no se herede.

## @rad/core 0.7.0 · @rad/skin-glass 0.1.0 · Rad Vitrina 0.6.0 (2026-11-23)

- **Glass, la segunda piel.** Vidrio ahumado sobre una luz lejana: el fondo de
  la ventana es un telón casi negro con tres campos de color apagados, el
  chrome vive directo sobre él y el escenario es una hoja que lo deja pasar.
  Los campos son pozos tallados, el primario es el único vidrio con luz propia,
  y lo que flota (menús, toasts, tooltips, el velo del modal) esmerila de
  verdad lo que tiene atrás.
- **Contrato v4: las superficies 1 a 3 pueden ser translúcidas.** `surface-0`
  sigue opaca. El verificador mide las otras compuestas sobre ella. No hay
  tokens nuevos: classic no cambió.
- Lo que el vidrio pidió y cómo se resolvió sin tocar el núcleo: el escenario
  se pinta opaco (el velo sobre el mismo telón, alineado) para que el fundido
  entre vistas siga tapando; el canto de la hoja va en un `::after` por encima
  de las vistas; el escenario aísla su apilado para no pintarse sobre un
  modal; y lo que esmerila entra y sale solo por opacidad.
- La vitrina tiene un **selector de piel** (la vista Pieles): se cierra y
  vuelve a abrir con la elegida, y se acuerda. `RAD_SKIN=<id>` la fuerza.
- El **humo corre una vez por piel**, y la segunda pasada comprueba que la
  vitrina se acordó de la piel. Las esperas del guion salen de las duraciones
  de la piel, y se suma una comprobación: una vista tiene que tapar.
- `npm run shots -- <piel>`: capturas de la vitrina escena por escena, para
  diseñar una piel mirándola.

## @rad/core 0.6.1 · Rad Vitrina 0.5.2 (2026-11-23)

- Actualizaciones desde GitHub (`updater.cjs` + `wireUpdates()`), probadas de
  punta a punta: la 0.5.1 instalada encontró la 0.5.2, avisó, la bajó con el
  botón, se instaló en silencio y el humo pasó entero sobre la versión nueva.
- `tools/release.mjs` publica verificando contra lo que quedó en GitHub;
  `tools/test-update.mjs` prueba una actualización real.
- La vitrina publica en `kiddshady/rad-releases` (0.5.0, 0.5.1 y 0.5.2) y
  muestra su versión en Datos.

## Rad Vitrina 0.5.0, la primera empaquetada (2026-11-23)

- electron-builder 26 en el monorepo. La vitrina se empaqueta con su bloque
  `build`, y los paquetes `@rad/*` entran al asar como dependencias normales:
  el asar quedó con el núcleo, la piel, las fuentes y la app, nada más (384 KB).
- Instalador NSIS (`Rad Vitrina-Setup-0.5.0.exe`) con los campos del
  ejecutable de Kidd Shady · Umbrovex Systems.
- Ícono horneado desde el código con la baldosa estándar: un núcleo y su
  anillo, en los colores de classic. `tools/icon-kit.mjs` dibuja cada tamaño a
  su tamaño y arma el .ico (PNG de 128 para arriba, DIB abajo);
  `tools/icon-sheet.py` lo compara con los íconos de las otras apps.
- La ventana usa el `.ico` en Windows, igual que el ejecutable.
- `npm run smoke:pack` corre las dos pasadas del humo contra la app
  empaquetada: pasaron enteras, con el protocolo leyendo desde el asar.

## @rad/core 0.5.2 (2026-11-23)

- Los tooltips ya no quedan pegados al recorrer rápido con Tab. Cerrar algo
  que todavía venía entrando daba vuelta su animación de CSS; al rato el
  temporizador de la entrada lo asentaba (apagaba la animación), eso
  cancelaba la vuelta y el elemento quedaba entero, abierto y fuera de toda
  salida. Ahora la salida a mitad de la entrada es una animación propia
  encima, desde la opacidad que tiene, y sale del DOM al terminar o al
  vencer su plazo, pase lo que pase. Nada se asienta mientras se va.
- Lo que ya terminó de entrar (el modal, que nunca se asienta) sigue
  saliendo con su salida propia.
- El humo recorre los tooltips cerrándolos a mitad de la entrada con
  distintas esperas, y comprueba la salida del modal.

## @rad/core 0.5.1 (2026-11-23)

- El relevo de un texto (la statusbar, el subtítulo, el valor de un select)
  ya no encima las dos frases: lo viejo sube apenas y se va del todo, y
  recién ahí entra lo nuevo subiendo desde abajo. Antes el nuevo asomaba con
  el viejo todavía al 9 %.
- La frase nueva ya no salta de costado en el lado derecho de la
  statusbar: los ítems del relevo se alinean al lado de su celda. Antes nacía
  contra la izquierda del ancho de la vieja y saltaba 50 px al irse esta.
- El humo mide el relevo cuadro por cuadro (las dos opacidades y el borde
  del texto con un Range, no de la caja) y muestra sus datos también cuando
  falla.

## @rad/core 0.5.0 · @rad/skin-classic 0.5.0 (2026-11-23)

La etapa 5: classic completa.

- Campos (`.rad-field`, `.rad-input`, etiqueta y pista) con su propio estado
  de foco: en un campo de texto Chromium prende `:focus-visible` también con
  el mouse, así que ahí no va el anillo de teclado. Sin flechitas en los de
  número ni manija para estirar en los de texto largo.
- `setFieldError()`: el renglón del error se despliega y se pliega, y el
  mensaje se releva si cambia.
- Check, radio y switch dibujados: el input nativo queda adentro, invisible
  pero vivo (teclado, formularios, lectores de pantalla). El tilde se dibuja,
  el punto crece y el pulgar viaja.
- `createSelect()`: un select propio que despliega un menú del ancho del
  botón, abre con el elegido activo, saltea los deshabilitados y resuelve la
  trampa del ancla. El menú suma items con tilde (`checked`).
- `.rad-iconbutton`, con estado apretado (`aria-pressed`).
- Classic los viste: los campos son un pozo un escalón más abajo que la
  hoja, y el contorno pasa al acento al enfocarlos.
- La vitrina suma la vista Controles con un formulario de verdad, y lo
  provisorio (el campo de la nota, los botones de ícono) pasa a ser del núcleo.
- El humo prueba cada control: el tilde entero, el pulgar que viaja, un solo
  radio por grupo, el deshabilitado, el select con teclado y el error que se
  despliega y se pliega.

## @rad/fonts 0.2.0 · @rad/core 0.4.2 · @rad/skin-classic 0.4.2 (2026-11-23)

- Cada app elige sus fuentes al arrancar: `rad.start({ fonts: { mono:
  'roboto-mono' } })`. La elegida va adelante y la de la piel queda de
  reserva. Sin elección, manda la piel.
- `@rad/fonts/catalog.json` lista las fuentes y para qué rol sirve cada una
  (`roboto-mono`, `cascadia-mono`). Un id que no existe frena el arranque con
  la lista de los que hay.
- El núcleo carga el CSS de la fuente elegida, la pide explícitamente y
  espera a que esté antes de entrar.
- Classic ya no carga Roboto Mono: su mono sigue siendo Cascadia.
- El humo corre la segunda pasada con Roboto Mono elegida.

## @rad/fonts 0.1.0 · @rad/core 0.4.1 · @rad/skin-classic 0.4.1 (2026-11-23)

- Nuevo paquete `@rad/fonts`, con Roboto Mono variable (pesos 100 a 700,
  normal e itálica, latin y latin-ext; licencia OFL). Se sirve en
  `rad://app/@fonts/` y cualquier piel o app la carga con
  `@import url('/@fonts/roboto-mono.css')`.
- Va con `font-display: block`, y el arranque espera a `document.fonts.ready`
  antes de entrar: el texto nunca cambia de forma ya a la vista.
- Classic la carga y la vitrina muestra Cascadia Mono y Roboto Mono lado a
  lado. El mono de classic sigue siendo Cascadia hasta decidirlo.
- El verificador de pieles sigue los `@import` absolutos (`/@fonts/`, `/@core/`).

## @rad/core 0.4.0 · @rad/skin-classic 0.4.0 (2026-11-23)

La etapa 4: el guardado y el puente.

- Store de documentos JSON: temporal único, cola por documento, `.bak` del
  anterior, reintentos ante EPERM/EBUSY/EACCES, y un documento roto se
  aparta y se recupera del `.bak` en vez de pisarse. Lo pendiente baja al
  disco antes de salir.
- `openDoc()` en el renderer: `get`, `set`, `patch`, `update`, `on`, con los
  valores por defecto mezclados si el archivo es viejo.
- La ventana se acuerda de su lugar, su tamaño y si estaba maximizada, y
  vuelve al centro si su monitor ya no está.
- Instancia única.
- Puente de la app: `rad.handle` / `rad.send` en el main, `rad.invoke` /
  `rad.on` en el renderer, solo por canales `app:*`.
- Los links a la web se abren en el navegador del sistema.
- `hold()`: el arranque espera a que la app arme su interfaz, para que no
  aparezca de golpe después del fundido de entrada.
- `RAD_DATA` para correr con datos descartables.
- `npm test` prueba el store con node pelado; el humo abre la vitrina dos
  veces sobre los mismos datos y la primera sale por el cierre normal.

## @rad/core 0.3.1 (2026-11-23)

- El toast que se va ya no baja de golpe antes de deslizarse. La pila está
  anclada abajo y, al sacarlo del flujo, se achicaba y se lo llevaba (52 px
  con tres toasts); el último, que la dejaba vacía, se cortaba contra el
  borde de la ventana. Ahora sale anclado por abajo y se queda en su lugar.
- Lo que se cierra antes de pintar su primer cuadro de entrada se va directo,
  en vez de aparecer entero para desvanecerse.
- El humo ya no depende de quien esté usando la PC: su ventana no toma el
  foco, no recibe el mouse real y sigue pintando aunque esté tapada.

## @rad/core 0.3.0 · @rad/skin-classic 0.3.0 (2026-11-23)

La etapa 3: lo que flota.

- Capa de overlays hermana de la raíz, con una pila que decide quién atiende
  el Escape, y `place()` para colocar junto a un ancla dándose vuelta si no
  entra.
- `present()` / `dismiss()`: entrada, asentado y salida. Cerrar algo que
  todavía venía entrando da vuelta la entrada desde donde iba.
- `flip()`: lo que cambia de lugar viaja con transform.
- Tooltips con `data-rad-tip` (y atajo opcional), con espera la primera vez y
  enseguida las siguientes.
- Menús con teclado completo, items deshabilitados, peligrosos y separadores,
  y la trampa del ancla resuelta.
- Modales con la app inert atrás, Tab que da la vuelta y foco que vuelve; y
  `confirm()`.
- Toasts que se apilan, viajan al acomodarse, se frenan con el mouse y nunca
  pasan de cuatro.
- `.rad-button` en el núcleo, con variantes primaria, peligrosa y callada.
- Contrato v3: anchos de menú, modal, toast y tooltip. Las perillas de
  anatomía (`--rad-a-*`) no son tokens y una piel las puede pisar.
- El humo prueba todo esto desde adentro de la vitrina.

## @rad/core 0.2.0 · @rad/skin-classic 0.2.0 (2026-11-23)

La etapa 2: el shell y el router.

- `createShell()`: titlebar propia con minimizar, maximizar/restaurar (los
  íconos se relevan) y cerrar; rail con indicador que viaja y navegación con
  flechas; escenario; statusbar de dos lados.
- `createRouter()`: vistas que se montan al primer uso y quedan vivas con su
  scroll. El cambio es un fundido con la nueva quieta debajo; dos cambios
  seguidos apilan bien, y una vista que vuelve sube desde donde iba.
- `motion.js`: duraciones y curvas leídas de los tokens, plazo de red en toda
  salida y `swapText()`, el relevo chico de un texto.
- La raíz apaga su animación de entrada al terminar, para no retener opacidad
  ni transform.
- Contrato v2: cinco tokens de medidas del shell (`titlebar-height`,
  `rail-width`, `statusbar-height`, `control-height`, `icon-size`).
- El puente expone la piel y la versión del núcleo, y avisa al maximizar.
- Classic viste el shell: chrome sobre el fondo y el escenario como una hoja
  un escalón más arriba.
- El humo corre un guion adentro de la vitrina: mide el fundido cuadro por
  cuadro, la ida y vuelta, el apilado, la statusbar, el indicador y el scroll.

## @rad/core 0.1.0 · @rad/skin-classic 0.1.0 (2026-11-23)

La etapa 1: el esqueleto.

- El monorepo con workspaces de npm: el núcleo, la piel classic y la vitrina.
- El contrato de tokens v1: 54 tokens en superficies, texto, acento, estado,
  líneas, scroll, forma, espacio, tipografía, elevación y movimiento.
- La ventana sin flash: nace fuera de pantalla, se muestra ahí y a los 200 ms
  se muda a su lugar, con el fondo de la piel desde el primer frame.
- El protocolo `rad://` que sirve el núcleo, la piel y la app desde un solo
  origen, leyendo con fs para que ande también empaquetado.
- El puente `window.rad` con los controles de ventana.
- El arranque del renderer: el contenido entra recién con la ventana en su lugar.
- Lo nativo de Chromium reemplazado: foco, selección y scrollbar propios, y el
  esfumado del scroll por lado.
- La piel classic: grafito, acento azul acero, sombras suaves.
- Verificadores del núcleo y de las pieles, y el humo de la vitrina.
