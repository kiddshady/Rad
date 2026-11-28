# Changelog

## BlackCode 1.24.0 (2026-11-28)

Hablarle a un agente con un micrófono de la PC, en modo conversación
(pedido de Fran: «una conversación más larga y fluida con Zac»; con su
webcam Redragon). Lo probó en dev: «está tremendo… anda re bien y la cámara
escucha desde más lejos».

- **Settings › Voice: «Listen with»** el Atom Echo o un micrófono de la PC,
  **nunca los dos**: elegir uno desconecta el otro. Con el Echo todo sigue
  igual (palabra clave y una frase).
- **Con el micrófono de la PC es una conversación.** «okay zac» o
  **Ctrl+Alt+Z** (global, también con la app en la bandeja) la abren; después
  de cada respuesta, cuando terminó de sonar, el micrófono vuelve a escuchar
  solo, sin palabra clave. Se cierra diciendo **«gracias, Zac»** (la eligió
  él: «chau y listo quedan medio mal»; eso no le llega al agente), con **30 s sin hablar** o con el atajo.
  Mientras el agente habla no se toman frases, solo la palabra clave, que lo
  calla.
- **La palabra clave en la PC** es el mismo modelo de microWakeWord del Echo
  (el .json que se elige en Settings, con su .tflite al lado), corriendo en
  el Python de Whisper con `pymicro-wakeword` (`motor/palabra_motor.py`,
  `main/palabra.cjs`): unos 20 ms de CPU por cada 3 s de audio.
- **La captura** (`renderer/micro.js`, `micro-worklet.js`): el micrófono
  queda abierto con el cancelador de eco de Chromium, a 16 kHz, y va al
  proceso principal de a 100 ms. La conversación es `main/micro.cjs`.
- **Dos cosas que salieron de probarlo con la webcam de verdad** (frases con
  la voz de Windows por los parlantes): el detector avisa unos 400 ms tarde,
  ya por la mitad de lo que se pide, así que la frase arranca con el último
  segundo y medio de audio (lo que entra de la palabra lo saca el mismo filtro
  del Echo); y el ruido del cuarto se mide todo el tiempo, porque la frase se
  abre mientras se sigue hablando y el corte tomaba la voz por ruido. A
  Whisper se le pasa la frase de cierre como pista (la primera que se
  probó, «Chau Zac», salía «Chilsec»).
- `tools/test-blackcode-micro.mjs` (60 comprobaciones, cada arreglo probado
  al revés) y su parte en el humo, que **no abre el micrófono de verdad**.
  Control nivel 2 verde (tests, dos pasadas del humo y modo real).

## BlackCode 1.23.0 (2026-11-27)

«New chat» ya no llena la lista de chats vacíos (pedido de Fran, con un
video: cada vez que tocaba «New chat» desde otro chat quedaba un «New chat»
más en la columna, aunque no mandara nada).

- **«New chat» abre un borrador**: la conversación en blanco con el campo
  para escribir, pero sin fila en la lista. El chat entra a la lista, elegido,
  recién con el primer mensaje. Tocar «New chat» estando en un borrador no
  abre otro.
- **Salir de un borrador sin mandar nada lo descarta**, de la lista y del
  disco. El de otro agente queda guardado sin verse: al volver a ese agente,
  sigue ahí. Al abrir la app se van los que quedaron de la sesión anterior y
  los «New chat» vacíos de antes. Antes de borrar uno, se mira su documento:
  si tiene mensajes, no se borra (se le corrige la cuenta).
- Un chat de canal (voz, Telegram) nunca es borrador. El celu tampoco ve los
  borradores en su lista.
- El humo comprueba el borrador fuera de la lista, que entra con el primer
  mensaje, que al salir se descarta (también su documento) y que «New chat»
  no apila otro. Control nivel 2 verde (tests, dos pasadas del humo y modo real).

## BlackCode 1.22.1 (2026-11-27) · núcleo 0.21.4

Dos fantasmas al pasar entre Notes y Memory, que Fran grabó en video y
probó arreglados en dev («los dos solucionados»).

- **«New note» reaparecía un instante después de irse Notes, y al volver
  entraba tarde y de golpe.** La fila de arriba de la lista (la de «New
  note», y la de «New chat», que es la misma regla) se prendía con la
  `visibility` demorada, pensada para el relevo con la barra de la
  selección; pero la demora valía también cuando la vista entera se ocultaba
  o se mostraba. Ahora la que se ve se prende sin demora (la demora queda en
  la opacidad) y la fila sigue a su vista en el mismo cuadro. Ojo: las
  capturas por CDP no mostraban el fantasma, aunque la `visibility` medida lo
  confirmaba.
- **La línea del canto cruzaba por encima de las hojas de Memory a Notes**
  (núcleo y glass). El canto del escenario va encima de todo (`::after`,
  z 2000) y se esfumaba «a la par» del cambio, dibujado sobre las hojas de la
  otra vista: por la esquina y por el aire entre los paneles. Ahora el router
  marca el cambio de forma (`data-rad-sheets-swap`, de una vista de hojas a
  una común o al revés) hasta que la que se va termina de irse, y glass le
  pasa el canto a la vista común mientras dura: se funde con ella, y al
  terminar vuelve al escenario en el mismo cuadro.
- El humo de las hojas mide las dos cosas cuadro por cuadro en los dos
  sentidos (y falla con cada arreglo deshecho).

## BlackCode 1.22.0 (2026-11-27)

Un lote de cinco cosas que Fran fue encontrando y probó en dev («impecable
todo»).

- **Clic derecho en Notes.** En una nota: *Edit*, *Pin*/*Unpin*, *Move to a
  folder…* y *Delete*, sobre ESA nota y no sobre la abierta (las acciones de
  la cabecera pasaron a tomar el id de la nota). El menú del núcleo no tiene
  submenús: *Move to a folder…* abre las carpetas en el mismo punto. En una
  carpeta, lo mismo que el botón de los tres puntos, que se queda («que estén
  ambos»). «Unfiled» no tiene menú, y seleccionando, el clic derecho en una
  nota no abre nada.
- **Las carpetas de Notes sin contador** de notas («no son necesarios»).
- **Borrar una carpeta se lleva sus notas**, para siempre como el borrado
  del usuario (antes quedaban sueltas). El aviso dice cuántas se van; si la
  abierta estaba adentro, la hoja se cierra y lo pendiente no se guarda; una
  nueva sin guardar queda suelta. En el store, `deleteFolder(id, { conNotas })`
  (sin la opción sigue como en NeonCode); el test lo prueba, y falla con la
  opción apagada.
- **La scrollbar de la conversación ya no queda flotando al cerrar un panel**
  (navegador, canvas, terminal). El hueco del panel se suelta recién cuando
  el panel terminó de irse, y hasta ahí la conversación sigue angosta: su
  pulgar quedaba solo en el medio. Ahora se funde con el panel y vuelve a
  entrar en su lugar; al abrir, entra fundiéndose en el lugar nuevo. El
  pulgar es un pseudo-elemento y no acepta transiciones, pero toma el valor
  andando de su dueño: `--dm-pulgar`, registrada con `@property`.
- **Una respuesta frenada antes de escribir nada ya no deja el nombre del
  agente colgando.** Un tramo vacío abre el turno solo si debajo vienen sus
  tools; si no, el nombre pasa al tramo siguiente. Y el tramo se pliega en
  vez de irse de golpe, con WAAPI y medidas en píxeles: `interpolate-size`
  en Chromium 152 deja el alto en `auto` hasta el final y salta.
- El humo comprueba todo lo anterior.

## BlackCode 1.21.2 (2026-11-27) · núcleo 0.21.3

Dos arreglos estéticos que pidió Fran.

- **El formulario del agente scrollea con esfumado, como Settings.** Antes
  scrolleaba el modal entero (el título y los botones se iban con el
  formulario) y lo recortado se cortaba en seco. Ahora el modal no
  scrollea: «New agent» y los botones quedan quietos, y el cuerpo es un
  `rad-scroll` del núcleo, que esfuma arriba y abajo lo que recorta. El
  cuerpo va de borde a borde (la scrollbar sigue contra el canto) y el
  esfumado ocupa el lugar del gap: el aire hasta los botones es el de antes;
  bajo el título, 12 px más.
- **La esquina del panel ya no se pone en punta al pasar de Memory a Notes**
  (núcleo). Notes es una vista de hojas: al ir a ella el escenario deja de
  recortar en el acto (para que la sombra de las hojas no se corte), y
  Memory, que se iba esfumando, mostraba sus esquinas cuadradas unos 130 ms.
  Medido por CDP sobre el píxel de la esquina: subía de 41 a 58–60 durante
  ese rato; ahora queda en 39–41. Cada `.rad-view` lleva
  `border-radius: inherit` (las esquinas del escenario).
- El humo comprueba las dos cosas (y las dos comprobaciones fallan sin el
  arreglo).

## BlackCode 1.21.1 (2026-11-27)

**En Telegram, la negrita de un agente salía en cursiva.** Fran lo vio
probando el puente con su bot: Zac escribía la negrita como se escribe en
Telegram (`*así*`), y en markdown común un asterisco solo es cursiva, que es
lo que BlackCode convierte. La nota que acompaña a un turno de Telegram ahora
le pide markdown común, con la negrita de dos asteriscos, y le aclara que las
imágenes de `run_code` (gráficos, moléculas) también le llegan al celu: Zac
no estaba seguro. El test de Telegram lo comprueba (y falla con la nota de
antes).

## BlackCode 1.21.0 (2026-11-27)

**Telegram: hablarle a un agente desde Telegram, con un bot propio.** Fran lo
pidió para hablar con Zac desde el celu, y eligió las cuatro recomendadas:
solo su cuenta, un chat que sigue hasta /new, los permisos con botones y,
además del texto, fotos, audios con Whisper y respuesta en audio.

- `main/telegram.cjs`: BlackCode le pregunta a Telegram por los mensajes del
  bot (getUpdates con espera larga), desde esta PC: sin servidor ni puerto
  abierto, así que el bot contesta mientras BlackCode está abierta (en la
  bandeja alcanza). El token se comprueba con Telegram al guardarlo, va
  cifrado en `_telegram` y no vuelve a la interfaz.
- **Solo la cuenta vinculada.** Hasta vincular, el bot solo dice cómo
  hacerlo; quien le escribió aparece en Settings › Integrations › Telegram
  con «This is me». Ya vinculado, a cualquier otro no le contesta nada, y lo
  suyo ni llega a la interfaz. Los grupos se ignoran.
- **Un chat que sigue.** Lo que llega va al chat de Telegram del agente
  elegido (`canal: 'telegram'`), en el grupo Channels con «Telegram ·» y la
  fecha; cada mensaje dice «Sent from Telegram» con un avión de papel (ícono
  nuevo, `avion`). /new arranca otro chat, /stop frena la respuesta, /help.
  `datos.deCanal(c)` reúne los chats de voz y los de Telegram.
- **Los permisos, con botones.** Un turno de Telegram va en manual salvo
  «Let Telegram act» (apagado de fábrica): lo que pide permiso llega como un
  mensaje con Allow / Always in this chat / Deny, y al tocarlo la tarjeta se
  cierra diciendo qué se eligió. Si se contesta en la PC, los botones se van.
- **Fotos, archivos y audios.** Una foto (o una imagen como archivo) entra
  como adjunto, un archivo de texto como los de la PC (hasta 256 KB). Un
  audio se pasa a PCM con ffmpeg (`main/ffmpeg.cjs`) y a texto con el mismo
  Whisper del Atom Echo; la respuesta vuelve como nota de voz (OGG/Opus) con
  la voz elegida en Settings › Voice, con el texto debajo si entra. Se apaga
  con «Answer voice messages with voice». `voz.cjs` suma `oir()` y
  `grabar()`: un turno que se graba no suena por los parlantes.
- La respuesta va en el HTML de Telegram (`main/telegram-formato.cjs`):
  negrita, cursiva, código, bloques de código, enlaces; los títulos en
  negrita y las tablas como texto alineado. Lo largo se parte en varios
  mensajes, y si Telegram rechaza el HTML va en texto plano. Las imágenes
  que dejaron `generate_image` y `run_code` se mandan como fotos.
- El agente sabe que lo leen en Telegram (una nota en las instrucciones), y
  si era un audio, que lo que conteste se va a oír.
- Pruebas: `tools/test-blackcode-telegram.mjs` (84, contra el Telegram de
  mentira de `main/telegram-simulado.cjs`, con ffmpeg de verdad) y una
  sección del humo con el circuito entero; la pasada 2 comprueba que el bot
  vuelve prendido, vinculado y conectado.

## BlackCode 1.20.0 (2026-11-27)

**Whisper queda cargado mientras el Atom Echo está conectado.** Medido en la
3060: en frío tarda unos 14 s, y como se descargaba a los cinco minutos sin
uso, la primera orden después de un rato esperaba unos 10 s de más (la carga
arrancaba con la palabra clave y solo una parte quedaba tapada por lo que se
hablaba). Fran eligió dejarlo siempre cargado.

- `escucha.cjs` acepta `mantener()`: mientras diga que sí, el rato sin uso no
  lo apaga. `voz.cjs` lo ata a «la escucha prendida y el Echo conectado»; si
  el Echo se desconecta, se apaga a lo sumo cinco minutos después.
- El modelo empieza a cargar apenas el Echo conecta (al abrir la app o al
  volver después de un corte), no recién con la palabra clave.
- Al cargar hace un ensayo con un segundo de silencio: la primera frase en la
  placa tardaba 0,9 s y ahora 0,4 (las demás, 0,3).
- Después de cada frase devuelve a la placa la memoria de trabajo
  (`torch.cuda.empty_cache()`): cargado ocupaba ~5 GB y ahora ~3,4, sin
  cambiar lo que tarda.
- Settings › Voice dice que el modelo queda cargado mientras el Echo esté
  conectado, y que carga cuando el Echo conecta.

## BlackCode 1.19.1 (2026-11-27)

**La tool `remember` ya no le dice al agente que su memoria la ven todos.**
Desde la 1.18.0 cada agente tiene la suya, pero la descripción de la tool
seguía diciendo que el recuerdo se sumaba a «the Memory list that every agent
in this app sees». Ahora dice que es SU lista y que ningún otro agente la ve.
El test de la memoria lo comprueba (y falla con el texto de antes).

## BlackCode 1.19.0 (2026-11-27)

**El celu edita los agentes, su memoria y las skills.** Fran: «necesito que
efectivamente sea el lugar donde pueda modificar a mis agentes… si estoy lejos
de la UCX igual pueda cambiarles el modelo, ajustar qué tools usan, modificar
el system prompt… e incluso crear un agente nuevo», y lo mismo con Memory y
Skills: «con todo esto va a ser prácticamente el control remoto de BlackCode».
Esta versión es la mitad de la PC: el puente (`main/movil.cjs` y
`renderer/movil.js`) suma lo que BlackCode Mobile necesita para eso.

- **Agentes:** `GET /api/agents/catalog` (los proveedores con sus modelos,
  los grupos de tools y con cuáles nace uno nuevo), `GET /api/agents/:id`,
  `POST /api/agents` (crear), `POST /api/agents/:id` (guardar),
  `POST /api/agents/:id/move` y `DELETE /api/agents/:id`. Los guarda la
  interfaz con las mismas funciones que el formulario de la PC, revisando lo
  que llega como él: nombre obligatorio y de hasta 40, un proveedor que
  exista, un modelo de su lista (o el que el agente ya tenía aunque haya
  salido de ella), solo tools que existen, y las marcas de un servidor MCP
  apagado se conservan. El último agente no se borra. `/api/state` dice
  además con qué habla cada uno y qué grupos de tools usa de verdad.
- **Memoria:** `GET /api/memory/:agente`, `POST /api/memory/:agente/core`
  (con su base, como la vista: lo que un agente agregó mientras tanto se
  conserva), y agregar, cambiar y borrar recuerdos. Siempre con el agente: la
  de uno nunca se cruza con la de otro.
- **Skills:** leerlas, escribirlas y renombrarlas, apagarlas, borrarlas,
  importar un `.md` (`POST /api/skills/from-md`) y ver, aprobar o descartar
  lo que propone un agente (`/review`, `/approve`, `/discard`).
- **Eventos nuevos para el celu:** `agentes` (cambió un agente, o lo que su
  formulario ofrece: modelos y tools), `memoria` (con el agente) y `skills`.
- Lo que llega del celu viaja con su nombre (`agente`, `recuerdo`, `skill`),
  nunca como `id`, que pisaría el número del pedido (el bug de la 1.12.0).
- Tests: el puente (las rutas nuevas, que `catalog` no se tome por un
  agente, que solo `true` prenda una skill, que mover sea de a un lugar) y
  el humo con los stores de verdad: un agente nace, se edita, se mueve y se
  borra desde el celu y la vista Agents de la PC lo sigue sola; un recuerdo
  no se cruza a otro agente; una skill se escribe, se apaga, se renombra
  (sigue apagada), se importa de un `.md` y se borra.

## BlackCode 1.18.1 (2026-11-27)

**Borrar un agente se lleva todo lo suyo.** Hasta ahora sus chats y sus tareas
se iban con él, pero sus canvas quedaban sueltos en la base y su memoria en su
cajón, sin que nadie los viera. Fran: «que se lleve todo a la tumba».

- **Sus canvas se borran de verdad**, sin pasar por la papelera: los que
  anotan su agente, los de antes de la 1.8.2 que no lo anotaban si su chat
  era de él, y los que ya estaban en la papelera. Un canvas huérfano viejo,
  sin agente ni chat, no es de nadie conocido y queda.
- **Su memoria entera se borra**: su «About you» y su lista. La de los demás
  agentes no se toca, y uno nuevo arranca vacío aunque se llame igual.
- El aviso antes de borrar lo dice: «…with its chats, its canvases and its
  memory».
- **Las tools de un servidor MCP llevan el enchufe de Integrations**, el de
  Settings, en diagonal, en vez del vertical que vino de NeonCode. Va el
  mismo dibujo de `piezas.js`, no una copia. El humo comprueba que la fila
  de una tool de MCP lo lleva.
- **El navegador redondea la página a 8 px, no a 12.** La scrollbar flotante
  de Chromium, ancha (con el mouse encima), va a 1 px del borde con puntas de
  ~5 px, y la curva de 12 le comía las de arriba y de abajo: hasta 47 px de la
  barra según la escala. Con 8 no toca nada a 100 % ni a 150 %, y a 125 %
  apenas el borde suavizado (18 % en 3 px). Medido sobre la barra de verdad
  (Electron 44.10.1, el mismo de Prism, donde Fran lo vio). Y 8 es además el
  radio concéntrico con el panel: 16 de la piel menos los 8 de margen del
  hueco. Cambian juntos `setBorderRadius` de la vista y `.dm-nav-hueco`.
- Lo de agentes borrados antes de esta versión sigue en la base, y el
  respaldo de la memoria de antes de la 1.18 también.
- Tests: `removeByAgent` (los suyos de las cuatro formas, los de otro
  agente y el huérfano sin dueño quedan) y `olvidar` (su cajón se va, el
  otro queda entero, olvidar dos veces no rompe). El humo comprueba que
  borrar un agente se lleva su memoria y no toca la del otro.

## BlackCode 1.18.0 (2026-11-27)

**La memoria es por agente.** Hasta ahora era una sola para toda la app (así
vino de NeonCode, que tenía un único agente): trabajando con Mat en algo de
ciberseguridad le aparecían a Fran recuerdos de Zac, y a Zac los de Mat. Lo
pidió así: «necesito que las memorias sean por agente, puras, sin cruces con
otros».

- **Cada agente tiene su cajón**: su «About you» y su lista. `remember` y
  `recall` trabajan sobre el del agente de la corrida (el del padre en un
  subagente, el de la tarea en una tarea); el bloque del system sale del
  cajón del agente del turno; un agente nuevo arranca vacío. Una corrida sin
  agente no tiene memoria.
- **La vista Memory muestra un agente a la vez**, elegido con un select en la
  cabecera (Fran lo eligió sobre pestañas); arranca en el agente del chat y
  lo sigue cuando se cambia de agente ahí (el select es para mirar otro). Al
  cambiar, lo escrito en las tarjetas se funde por color, cambia y vuelve, en
  orden. Lo pendiente del «About you» del que se deja se guarda antes.
- **Lo que había se reparte solo** la primera vez que la app lee la memoria,
  sin mirar lo que dice ningún recuerdo (Fran pidió que no se leyera): cada
  recuerdo que anotó un agente va al agente del turno con un `remember` que
  empezó más cerca antes de su hora; si dos empatan, no va a ninguno. El
  «About you» y lo agregado a mano van copiados a todos (elección de Fran:
  son sobre él; los recorta después). El documento viejo queda entero de
  respaldo en el mismo archivo, sin que lo vea ningún agente. Probado en seco
  sobre los datos de Fran (solo cuentas): Zac 4, Mat 4, ninguno sin dueño.
- Tests: por agente sin cruces (tools, bloque, buscar, ids, borrar), el
  reparto (turno más cercano, empate, remember fallido, agente borrado) y el
  respaldo. El humo cambia de agente en la vista, mira el relevo en orden y
  que otro agente no reciba la memoria del primero, ni en la vista ni en el
  system.

## BlackCode 1.17.0 (2026-11-26) · @rad/fonts 0.3.0

Lote que pidió Fran, probado por él en la app de dev:

- **La letra es Inter.** La eligió en el typo lab (`npm run typolab`,
  commit 9966476), comparando sobre la app real: Inter en la interfaz y en
  los títulos, XS 11,5 px, S 12,5 px, L 14 px y el peso fuerte en 550 (M y
  XL quedan los de la piel). Inter viaja con Rad, como Roboto Mono: está en
  `@rad/fonts` (variable, con peso y tamaño óptico, normal e itálica,
  convertida a woff2 sin tocar los glifos; trae griego, subíndices y
  flechas), así que no depende de que la PC la tenga instalada. La app la
  pide con `fonts: { ui: 'inter', display: 'inter', mono: 'roboto-mono' }`
  y los tamaños van en `blackcode.css`. El humo mira que la interfaz se pinte
  en Inter cargada desde `/@fonts` y con esos tamaños. Inter dibuja más
  ancho que Segoe: el formulario del agente pasa de 540 a 560 px para que
  «DeepSeek V4.1 Flash 1017 Uncensored» se siga leyendo entero (el humo lo
  agarró por 2 px).
- **Exportar y bajar con bandeja.** Los dos íconos tienen abajo una bandeja
  con un palito a cada costado, como la dibujó Fran, en vez de una sola
  línea. En bajar la flecha sube medio punto para no tocarla con la punta.
- **Sin «no tools».** Una respuesta que no usó tools ya no lo dice debajo
  («casi todo el tiempo no usa tools»): que no aparezca nada lo dice. Cuando
  usa, la cuenta sigue igual. El «no tools» de la barra de estado (el agente
  con las tools apagadas) queda.
- **El visor de imágenes ocupa la ventana entera**, sin esquinas, con la
  misma barra y los mismos botones («me da incomodidad visual que queden
  esos huecos en los laterales»). Tapa la titlebar y le anula el arrastre:
  si no, un clic arriba de la imagen movía la ventana. El humo lo mide.

## BlackCode 1.16.0 (2026-11-26)

**ElevenLabs como segunda voz de las respuestas habladas** (pedido de Fran:
«agregar como provider a elevenlabs… para hacer unas pruebas con los créditos
que tengo»):

- **La llave va en Settings › Providers**, como las de los modelos, con el
  ojito y cifrada (`_llave_elevenlabs`). Se comprueba pidiendo la primera voz
  de la cuenta (`GET /v2/voices?page_size=1`), que no gasta créditos; si la
  llave no puede leer las voces, lo dice y explica qué permiso falta.
- **En Voice › Spoken answers hay un select «Voice engine»:** Qwen3-TTS (esta
  PC, como hasta ahora) o ElevenLabs. Lo de cada motor va en su caja y la del
  que no se usa se pliega, con un relevo en orden (la que se va se apaga y se
  pliega, y recién después se abre la otra).
- **Las voces salen de la cuenta** (las de la biblioteca y las clonadas en su
  web; Fran ya tiene a Zac ahí): BlackCode no crea ni sube nada. El modelo
  arranca en **Flash v2.5** (eligió Fran: el más rápido y el que gasta la
  mitad), y los demás salen de `GET /v1/models` (solo los que hablan).
- **Suena igual que Qwen:** `main/elevenlabs.cjs` tiene la misma forma que
  `habla.cjs` y pide PCM de 16 bits a 24 kHz por streaming
  (`output_format=pcm_24000`), así que el audio va por el mismo camino a la
  interfaz. Una frase por pedido, con `previous_text`/`next_text` para que
  suene de corrido y `language_code` (salvo con Multilingual v2, que no lo
  acepta). La palabra clave y Stop cortan el pedido en curso, y lo que
  faltaba no se pide.
- **Sin gastar créditos en las pruebas:** en modo simulado no sale a
  internet; el humo y `tools/test-blackcode-elevenlabs.mjs` (36
  comprobaciones) hablan con un ElevenLabs de mentira en 127.0.0.1
  (`ELEVENLABS_BASE_URL`). El humo mira el relevo de las cajas cuadro por
  cuadro, y el `.mjs` que el audio se haya pedido con la voz, el modelo y el
  idioma elegidos.

## BlackCode 1.15.0 (2026-11-26)

Ajustes que pidió Fran, probados por él en la app de dev:

- **El ojito de las llaves.** En Settings › Providers (y en las llaves de los
  buscadores, en Tools) el campo tiene un ojo adentro, a la derecha, como el
  de NeonCode. Con el campo vacío trae la llave guardada y la muestra en mono
  para copiarla; con algo pegado, solo lo destapa. Se vuelve a tapar al
  tocarlo, al cambiar de pestaña y al cerrar Settings; sin llave ni nada
  pegado queda apagado. Entre puntitos y letras el texto se funde por color:
  sale en `base` acelerando y entra en `slow` frenando (con `fast` las dos
  mitades se sentía brusco). Fran eligió esto entre tres opciones (las otras:
  sumar un «Copy key», o solo «Copy key» sin mostrarla): la llave en claro
  ahora llega a la interfaz, pero solo con el ojito (`llave:ver`); nunca va a
  un agente ni a una tool.
- **El tacho de Channels ya no queda pegado.** Se veía con cualquier foco
  adentro de la fila, también el que deja un clic (en la cabeza, o en el
  tacho al volver del confirm). Ahora: el puntero encima o el foco de
  teclado (`:has(:focus-visible)`).
- **«Jump to latest» con foco de teclado brilla** en vez de llevar el anillo
  (el brillo de NeonCode, del color del foco: blanco en la piel mono).
- **All canvases con menos aire arriba del Close:** se sumaban el esfumado
  de la lista, el gap del modal y el margen del pie (48 px); se fue el
  margen y quedan 36. Vale también para el historial del navegador.
- En el humo: el tacho según el foco, el brillo, el aire del pie y el ojito
  (mostrar, tapar, lo pegado, pestaña, cierre, apagado sin llave).

## BlackCode 1.14.1 (2026-11-26) · núcleo 0.21.2

Ajustes que pidió Fran, probados por él en la app de dev:

- **La terminal, a 11 px** (eligió 11 sobre 12). A 13, en el panel de 560 px
  como mucho, entraban unas 56 columnas y la tabla de un `ls` de PowerShell
  partía los nombres letra por letra.
- **Su barra, del ancho de las demás.** xterm toma el ancho de la barra de
  `overviewRuler.width` (de fábrica, 14 px: el pulgar quedaba de 9, casi el
  doble que las otras); ahora usa `--rad-scroll-size`. Con eso xterm también
  arma su regla de marcas, que dejaba una raya clara al costado: no se dibuja.
- **Núcleo: el modal devuelve el foco sin el anillo si se abrió con el
  puntero.** Al renombrar un chat y cerrar con Enter, la fila quedaba con el
  anillo de foco (cerrar con una tecla dejaba a Chromium en modo teclado).
  Ahora el modal recuerda con qué se abrió: con el puntero, `focus({
  focusVisible: false })`; con el teclado, el anillo vuelve como siempre.
  Probado con mouse y teclas de verdad por CDP (al revés incluido), y en el
  humo de la vitrina se mira con qué opciones vuelve el foco.
- **El enchufe de Integrations, con el cable más largo** (4 en vez de 2: casi
  no se veía), centrado sin correrlo.

## BlackCode 1.14.0 (2026-11-26)

- **Las notas, desde el celu.** El puente suma `GET /api/notes`, `POST
  /api/notes` (crear), `POST /api/notes/:id` (guardar), `/pin`, `/folder` y
  `DELETE /api/notes/:id`, que la interfaz resuelve con los mismos canales de
  la vista Notes. En BlackCode Mobile: la lista con carpetas plegables,
  búsqueda y selección para borrar varias, y la nota que se lee dibujada y se
  edita como texto, guardándose sola. Crear, renombrar y borrar carpetas
  queda en la PC (Fran eligió ese alcance); desde el celu se mueve una nota a
  una carpeta que ya existe.
- El store de notas contesta que sí aunque la nota no exista: el puente se
  fija antes y da 404, y una carpeta que no existe también.
- Lo que cambia en un lado se ve en el otro: lo que escribe el celu le llega
  a la vista Notes de la PC como lo que escribe un agente (si hay texto sin
  guardar, no se pisa ninguna versión), y lo que se escribe en la PC (o un
  agente) se les avisa a los celus con el evento `notas`.
- Test del puente (60, las rutas nuevas probadas al revés) y su parte en el
  humo, con el store de verdad y la vista de la PC abierta.

## BlackCode 1.13.4 (2026-11-26)

- **Arreglado: en Settings se veía un select de otra pestaña.** El modelo de
  los subagentes (pestaña Tools) flotaba encima de las demás pestañas (Fran
  lo vio sobre la tarjeta del celu en Integrations). Las pestañas y las
  vistas se ocultan con `visibility: hidden`, y un hijo con `visibility:
  visible` propio le gana al padre. Lo que se prende adentro (los selects
  que se turnan, el «New chat», la barra de Notes, los paneles del chat) va
  ahora con `visibility: inherit`. Había dos fugas más del mismo tipo, sin
  ver: el «New chat» y la barra de Notes seguían a la vista con su vista
  oculta, tapados por la de encima.
- La sección `<fugas>` del humo recorre todas las vistas y las pestañas de
  Settings y busca algo de una oculta que se vea (probada al revés).

## BlackCode 1.13.3 (2026-11-26)

- **Borrar chats desde el celu.** El puente suma `DELETE /api/chats/:id`, que
  la interfaz resuelve como el tacho de la PC (`datos.borrarChat`): el chat
  se va en los dos lados. En BlackCode Mobile se seleccionan en el cajón,
  como en la PC (pedido de Fran: en el celu no había cómo borrarlos).
- Test del puente (49, la ruta probada al revés) y su parte en el humo.

## BlackCode 1.13.2 (2026-11-26)

- **Ctrl+Alt+B muestra o esconde BlackCode desde cualquier lado** (pedido de
  Fran, enseguida como toggle): al frente y con el foco la esconde en la
  bandeja (con la bandeja apagada, la minimiza); escondida, minimizada o
  detrás de otra ventana, la trae al frente como el ícono de la bandeja. Es
  un atajo global (`main/atajo.cjs`, sin Electron adentro): si otro programa
  lo tiene tomado BlackCode sigue igual, sin atajo, y Settings › General lo
  menciona solo si quedó registrado. Se suelta al cerrar. En el humo no se
  registra (no le roba el atajo a Fran mientras corre).
- Test con node pelado (16 comprobaciones, el toggle de ida y vuelta,
  probado al revés) y su parte en el humo de la bandeja.

## BlackCode 1.13.1 (2026-11-26) · núcleo 0.21.1

- **Notes: seleccionar y borrar varias**, como la lista de chats (pedido de
  Fran): la casilla al lado de la búsqueda entra a seleccionar, los botones
  de arriba dejan su lugar a la barra (Select all, cuántas, borrar, salir) y
  cada nota muestra su casilla; la nota se corre con transform y su fecha se
  apaga. Select all marca lo que se ve (con la búsqueda y fuera de las
  carpetas plegadas). Borrar es definitivo, como el de una nota (Notes no
  tiene papelera), y lo dice. Las carpetas no se seleccionan.
- **La lista de chats y la de notas se esfuman también abajo**, y la pista
  de la scrollbar se separa de las puntas lo mismo, así la curva de la hoja
  no le corta el pulgar.
- **Núcleo 0.21.1: sin la raya al pie de la hendidura.** Con una vista de
  hojas el escenario ya no recorta (cada hoja recorta lo suyo): la sombra de
  las dos hojas, que se suma en el aire del medio, se cortaba en seco en el
  borde de abajo del escenario y dejaba una línea recta. Ahora sigue de
  largo y se desvanece, como la del escenario.
- El humo mide las tres cosas (probado al revés).

## BlackCode 1.13.0 (2026-11-26) · núcleo 0.21.0

- **Chat y Notes en dos hojas sueltas**, como en Verba (pedido de Fran): el
  lado y la conversación (o la lista y la nota) son dos paneles flotantes
  con aire entre ellos, el mismo `space-2` que separa el escenario del borde
  de la ventana. La línea que separaba el lado se fue: separa el aire.
- **Núcleo 0.21.0: vistas de hojas.** Una vista con `sheets: true` se reparte
  en hojas `.rad-sheet` (el reparto es de la app). El router marca la vista
  y, mientras está activa, el escenario. Las hojas recortan lo de adentro
  como el escenario y llevan el canto en `::after`.
- **Pieles:** glass (y mono, que la hereda) pinta la vista de hojas como el
  telón, corrido igual que el escenario, así el aire se ve como el fondo de
  la ventana y la vista sigue tapando para el fundido; cada hoja lleva el
  velo, el brillo, el canto y `--skin-sheet-shadow` (glass 0.2.0). El
  escenario funde su canto y su sombra a la par del cambio de vista (la
  sombra a transparente con la misma forma, para que interpole). Classic
  0.6.0: la vista del color de la ventana y cada hoja del escenario.
- El humo mide el aire, el telón en el aire, el canto de las hojas y el
  fundido del escenario de ida y vuelta (probado al revés).

## BlackCode 1.12.0 (2026-11-26)

- **Canvases y Tasks en el celu.** El puente de BlackCode Mobile suma los
  canvas de un agente (los suyos y los huérfanos sin dueño, que son de
  todos), para leerlos, y las tareas programadas con su bandeja: listar,
  pausar o reanudar, correr ahora y leer un resultado, que queda leído. Los
  contesta la interfaz con los canales que ya usaba la pestaña Tasks y el
  panel del canvas; un agente no abre el canvas de otro. Cuando cambian (una
  corrida nueva, un canvas que escribe el agente) se le avisa al celu.
- **Un pedido del celu ya no se queda sin respuesta** si lo que pide se
  identifica con un `id` (un canvas, un resultado, una tarea): el número del
  pedido viajaba en el mismo campo y lo pisaba. Ahora va al final y los
  datos tienen sus nombres.

## BlackCode 1.11.0 (2026-11-26)

- **Buscar en la lista de chats.** Un campo «Search chats» debajo de «New
  chat» filtra los chats del agente por su nombre, sin importar tildes ni
  mayúsculas. Mientras se busca, los grupos plegados se abren (lo que
  coincide se ve siempre), y sin coincidencias la lista lo dice. La × o Esc
  borran lo buscado.
- **Borrar varios chats de una**, como en Umbra pero sin carpetas (Fran no
  las usa). El botón de al lado de la búsqueda entra a seleccionar: «New
  chat» deja su lugar a la barra de la selección (Select all, cuántos, borrar
  y salir), y cada fila muestra su casilla; un clic la marca en vez de abrir
  el chat. Select all marca lo que se ve con la búsqueda. Borrar pregunta
  antes y sale de la selección; Esc y cambiar de agente también salen. Los
  chats de canal no se seleccionan: su grupo ya tiene su «borrar todos». La
  casilla entra sin mover anchos (el texto se corre con transform).
- **Exportar con la flecha hacia arriba** (el del chat y el del canvas): la
  de abajo parecía bajar o importar. Ícono `exportar`; `bajar` queda para
  traer algo, como «Import» de Skills o «Save as…». Lo pidió Fran.
- Íconos nuevos en `piezas.js`: `lupa`, `seleccionar` y `exportar`.

## BlackCode 1.10.0 (2026-11-25)

- **El puente al celular**, para BlackCode Mobile (`S:\tools\BlackCodeMobile`,
  la app de Android que Fran está armando): los mismos agentes y chats, y los
  turnos corren en la PC. Se prende en Settings › Integrations › Phone
  (apagado de fábrica); al prenderlo nace una clave de 24 caracteres, cifrada
  con safeStorage, que la interfaz nunca ve: «Copy key» la copia desde el
  proceso principal. La tarjeta dice a qué dirección conectarse (el nombre de
  la PC o su IP de Tailscale) y cuántos celus hay conectados. Escucha en
  0.0.0.0:3830 y va detrás de Tailscale, nunca de un port-forward.
- **Cómo está hecho.** `main/movil.cjs` es solo transporte (HTTP, la clave, un
  canal de eventos por celu, las imágenes); los pedidos los contesta la
  interfaz (`renderer/movil.js`) con el estado vivo de los chats, por el
  mismo camino que la voz del Atom Echo. Lo que pasa en los chats llega al
  celu en vivo, también lo que se escribe en la PC, y el texto viaja en
  pedazos con su posición. Las imágenes van por referencia, nunca adentro del
  chat; desconectarse no frena un turno, solo el Stop. Un chat creado desde el
  celu no cambia el que está abierto en la PC (`crearChat(…, { elegir: false })`).
  Sale del puente de NeonCode, acotado a varios agentes.

## BlackCode 1.9.0 (2026-11-25)

- **Quién dijo cada cosa.** Arriba del primer mensaje de cada turno va el
  nombre de quien lo dijo, chico y en gris: el del agente (el de ahora, si se
  lo renombró) y el del usuario, que se pone en Settings › General («Your
  name»; vacío, «You»). Es solo de la interfaz: no viaja en ningún pedido a
  un agente (documento `perfil`). Es texto de verdad, así que entra al
  seleccionar y copiar, que sigue llevándose todo lo que se ve. Una respuesta
  partida en tramos lo lleva una vez, y si el agente llamó tools antes de
  escribir, el nombre queda igual arriba de ellas. Lo pidió Fran.
- **Exportar un chat a Markdown.** Un botón en la cabecera guarda el chat en
  un `.md` limpio (`renderer/exportar.js` lo arma, el proceso principal lo
  escribe con «Guardar como»): el título, el agente y la fecha, y cada turno
  con su nombre en negrita y lo que se dijo con su markdown original. Sin
  horas ni tools; las imágenes y los archivos como marcas; una respuesta
  cortada o fallida, con su nota. El formato lo aprobó Fran.
- **Los canvas sin chat tienen dueño** (lo encontró Zac: dos canvas del panel
  no le aparecían). Cada canvas guarda su agente al nacer, también el que
  crea una tarea programada; al borrar un chat sus canvas siguen siendo de su
  agente; y los huérfanos de antes, sin dueño conocido, los ve cualquier
  agente (las dos, decisiones de Fran). Columna `agent_id` en `canvas.db`,
  agregada sola en las bases que ya existían.

## BlackCode 1.8.1 (2026-11-25)

Retoques que Fran fue juntando al usar la 1.8.0:

- **La fila de la tool `canvas` lleva la hojita con el destello**, como el
  resto de la app desde la 1.5.2: la lista de íconos de las filas venía de
  NeonCode y seguía con los cuatro cuadrados.
- **El botón de tools de la cabecera:** prendido, en el gris de los botones
  de al lado (antes en blanco pleno, resaltaba más que ellos); apagado, más
  atenuado que ellos. Al pasarle el mouse se aclara como todos (su color
  propio le pisaba el del hover).
- **Sin anillo al cerrar el visor.** Al cerrarse, el visor le devuelve el foco
  a la miniatura, y con Esc Chromium le prendía el anillo de teclado, que
  quedaba pegado. Si se abrió con el mouse, ese foco vuelve sin anillo; si se
  abrió con el teclado, el anillo vuelve (dice dónde se está).
- **`chat_search` con menos ruido** (lo propuso Zac): de una tool se busca
  solo qué tocó (su ruta o su consulta), no lo que devolvió, y los mensajes
  van primero (las tools completan lo que sobra). Las fechas, en ISO
  (`2026-11-25 04:09`), como el sello de los mensajes.
- **El cursor de la terminal es el de NTX:** con foco, un bloque blanco del
  alto de la letra con aureola, que parpadea apagando las dos cosas juntas;
  sin foco, el mismo bloque apagado (no el contorno hueco de xterm). El
  bloque es un `::before` centrado en la celda, así el interlineado de la
  terminal no cambia.

## BlackCode 1.8.0 (2026-11-25)

- **Un agente puede recuperar lo que se habló en sus otros chats.** Lo propuso
  Zac y Fran lo pidió con una regla: **cada agente busca y lee SOLO en sus
  propios chats** (Zac no ve los de Oracle, ni con un id adivinado, ni desde un
  subagente o una tarea programada). Dos tools nuevas en el grupo Memory, de
  solo lectura, en `main/tools/chats.cjs`:
  - `chat_search`, portada de NeonCode (que la trajo de Umbra): palabras
    sueltas, primero los mensajes con todas y si no los que tienen alguna,
    agrupado por chat y con un fragmento. Cada coincidencia trae el id del
    chat y el número del mensaje. Sin consulta, los chats más recientes.
  - `chat_read`, nueva: un tramo de un chat, `around` un mensaje (cinco antes
    y cinco después) o `from`/`to`, por páginas. Las tools en una línea y las
    imágenes y los archivos como marcas.
- **Cada agente, sus canvas.** `read` abre también un canvas de otro chat
  propio (solo para leer), y el `list` con scope «all» y el `delete` ya no
  alcanzan los canvas de otros agentes: en NeonCode había un solo agente, acá
  varios. La tarjeta de permiso del borrado tampoco muestra uno ajeno. Una
  tarea programada, que antes podía leer cualquier canvas, ahora lee solo los
  de su agente.
- **Lo que no se hizo:** el resumen automático de cada chat que también
  proponía Zac (Fran: «es al pedo»).

## BlackCode 1.7.0 (2026-11-25)

- **Un visor de imágenes con zoom** (`renderer/visor.js`). Las imágenes del
  chat (la captura de `screen_capture`, las de `generate_image`, un gráfico
  de `run_code` y las que adjunta el usuario) se abren con un clic, con la
  lupa como cursor: casi del tamaño de la ventana, entera y con aire, con la
  rueda que acerca alrededor del puntero, arrastre cuando no entra, doble
  clic de entera a tamaño real, y `+` `-` `0` `1` y Esc. Pasado el 100 % se
  ven los píxeles. La imagen lleva esquinas redondeadas que miden lo mismo
  con cualquier zoom. Reemplaza al visor sin zoom de los adjuntos. Lo pidió
  Fran.
- **El clic derecho abre el menú de la imagen**, en la miniatura y adentro del
  visor. En una de `generate_image`, el de siempre (Open, Save as…, Show in
  folder, Copy path); antes un clic común abría ese menú, ahora abre el
  visor. Las que viajan en el chat (capturas, gráficos, adjuntos) no tienen
  archivo: traen Open y Save as…, y para eso el proceso principal las
  escribe (canales `imagenes:abrir-dato` e `imagenes:guardar-dato`).
- **El navegador abre los `.html` del disco**, para que un agente le muestre
  al usuario una página que armó. Solo `.html`, desde la barra o
  `browser_navigate` (ruta absoluta, `file:///…` o relativa a la carpeta del
  chat). La página carga lo de su carpeta y subcarpetas, salvo las que
  empiezan con punto y la carpeta de la app; una página web no lleva nunca
  a una local. Lo encierra un `protocol.handle('file')` en la sesión de las
  pestañas: sin él no se abre ninguna. Ver `docs/tools.md`.
- **La fila de `generate_image` lleva la varita** del grupo Images, en lugar
  del cuadro con la montaña.
- **La cabecera del chat dice solo su nombre:** el agente y el modelo ya los
  dice la barra de estado. Y la barra ya no dice a la izquierda en qué vista
  se está: lo dicen las pestañas.
- **El anillo de foco de la lista de chats sale entero.** Los grupos que se
  pliegan lo recortaban (arriba en la primera fila, a la izquierda en todas):
  ahora recortan con un margen del tamaño del anillo.
- **El tacho de Channels ya no se pone rojo** al pasarle el mouse: es como los
  demás tachos de la app. Lo de borrar lo avisa la confirmación.
- **Se acabó el nombre «daimon» donde se veía** (pedido de Fran): el paquete se
  llama `blackcode` (`npm run pack -w blackcode`) y el repo de releases,
  `kiddshady/blackcode-releases`. GitHub redirige `daimon-releases`, así que
  una instalada vieja se sigue actualizando. La caché del actualizador sale
  del nombre del paquete y pasa a `blackcode-updater`. El `appId` sigue
  siendo `com.umbrovex.daimon` a propósito: es lo que Windows usa para saber
  que es la misma app.

## BlackCode 1.6.0 (2026-11-25)

- **La app arranca en una pantalla de inicio.** Abría siempre en el último
  chat; ahora abre sin ningún chat elegido, con el símbolo de BlackCode (el
  dibujo entero, sin baldosa) en el centro y dos frases, las de Umbra: «Select
  or start a conversation» y «Create a new chat or select one from the sidebar
  to talk with an agent». El agente que estaba elegido sí se recuerda. La pidió
  Fran, «un estilo así como en Umbra».
- **Ahí no hay campo para escribir** (decisión de Fran): se escribe en un chat.
  Al crear o elegir uno, la pantalla de inicio se va y recién después entran
  la conversación y el campo, que queda con el foco. Tampoco dice con qué
  agente se va a hablar, porque se puede cambiar.
- Es también lo que se ve cuando un agente no tiene chat elegido: al cambiar
  de agente ya no se abre solo su último chat hasta que se elija uno en la
  sesión. La cabecera, sin chat, no dice «New chat».
- El símbolo sale del mismo script que el ícono (`scripts/icon.mjs` →
  `renderer/marca.png`): es el dibujo de la bandeja, a 368 px.

## BlackCode 1.5.2 (2026-11-25) · núcleo 0.20.1

- **Los avisos se ven con Settings abierto.** Desde que Settings es un modal,
  el aviso de «Check for updates» (y cualquier otro: una llave guardada, una
  tarea que terminó) salía por debajo de su velo: ni se veía ni se podía
  tocar. Lo vio Fran al actualizar a la 1.5.1.
- **En Tasks, el renglón de un resultado largo termina en puntos suspensivos.**
  Se cortaba a los 180 caracteres, y con la ventana ancha eso entraba en sus
  dos líneas: quedaba cortado en seco, a mitad de palabra. Ahora se corta más
  lejos (así el recorte del renglón pone los puntos) y, si se cortó, lo dice.
- **Los canvas tienen ícono nuevo:** un documento con la esquina doblada y un
  destello adentro («documento que escribió Zac»). Lo diseñó Fran con Zac;
  reemplaza a los cuatro cuadrados en el botón del chat, el panel y la
  biblioteca.
- **La pestaña Images lleva una varita mágica** con sus destellos, también
  diseñada por Fran con Zac, en lugar del cuadro con la montaña.
- **Settings también se esfuma abajo.** Lo que el borde del modal recorta al
  scrollear ya no se ve cortado: se esfuma, como en el canvas. Al llegar al
  final no queda esfumado, y una pestaña que entra entera no lo lleva.
- **Núcleo 0.20.1:** la pila de toasts va por encima de lo demás que flota
  (`z-index` propio en la capa de overlays; el tooltip, más arriba todavía).
  En la capa mandaba el orden de llegada, pero la pila se crea una sola vez,
  así que cualquier modal abierto después la tapaba. Pasaba con todos los
  modales; con uno que queda abierto mientras se trabaja, se nota.

## BlackCode 1.5.1 (2026-11-25)

Retoques de Settings y tres íconos, pedidos por Fran al ver la 1.5.0.

- **El título de la pestaña ya no lleva línea debajo.** Lo que sube se esfuma
  ahí en vez de cortarse contra una raya (el `rad-scroll` del núcleo). En
  reposo no hay esfumado, y el respiro de arriba mide lo mismo que él, así no
  toca la primera tarjeta. Abajo, contra el borde del modal, sigue cortando
  limpio.
- **Voice tiene su ícono:** la onda de Verba (las cinco barras de su marca, con
  sus proporciones). Llevaba el de los canales, que es el de los chats que
  entran solos.
- **Agents lleva el robotito de Umbra** (el `robot` de su `Icon.jsx`, tal cual:
  escalado de su grilla de 24 a la de 16, con el trazo compensado), en la
  titlebar y en «Manage agents».
- **El enchufe de Integrations va en diagonal,** como la llave y la
  herramienta que tiene arriba.

## BlackCode 1.5.0 (2026-11-25) · núcleo 0.20.0

- **Settings es un modal con pestañas.** Era una página larga con doce
  tarjetas una debajo de la otra: llegar a la voz o al About era scrollear
  todo. Ahora flota sobre la vista en la que uno esté (la forma del de Umbra):
  las pestañas a la izquierda, con ícono y nombre, y a la derecha el nombre de
  la que se ve, la × y sus tarjetas. Son siete: **General** (carpeta de
  trabajo, nombres de los chats, la bandeja), **Providers** (las llaves de
  Anthropic y Venice), **Tools** (el modo de permisos, la búsqueda web, los
  subagentes), **Images**, **Integrations** (los servidores MCP), **Voice** y
  **About**. Se cierra con Esc, con la × o con un clic afuera, y vuelve a
  abrir en la pestaña donde quedó. El botón Settings sigue en la titlebar.
- **El cambio de pestaña va en orden:** la que se ve se va del todo y recién
  ahí entra la nueva. El modal es de vidrio (su fondo no tapa), así que dos
  pestañas a medio ver en el mismo lugar se leerían una encima de la otra.
- **Ir a una vista lo cierra.** El «Open» de un aviso de voz, el ícono de la
  bandeja o «Review» de una skill llevan a su vista y Settings no queda
  tapándola. «Go to Settings», el aviso del chat cuando falta una llave, lo
  abre directo en Providers.
- **La llave es la de Prism** (la de su gestor de contraseñas, de contorno
  continuo y en diagonal), en la pestaña Providers y en ese aviso. La pidió
  Fran.
- **Núcleo 0.20.0:**
  - Un ítem de `views` con `action` (una función) en vez de `mount` va en la
    navegación como los demás pero no es una vista: al tocarlo corre su acción
    y la vista de atrás no cambia.
  - `openModal({ className, label })`: clases propias para el panel (un modal
    con otra forma) y un nombre accesible cuando no lleva título. El modal
    devuelve además `removed`, que se cumple cuando terminó de irse y salió
    del documento.
  - El router avisa `'go'` en cada pedido de ir a una vista, también a la que
    ya se ve (`'change'` sigue avisando solo cuando cambia).
  - `opacityNow()` de un nodo fuera del documento da 1 en vez de `NaN`: un
    relevo de texto en algo que todavía no se ve ya no tira.

## BlackCode 1.4.0 (2026-11-25)

- **Cada mensaje tiene su hora.** Se guarda con el mensaje (la del usuario, al
  mandarlo; la del agente, cuando termina de contestar) y se ve chica y gris
  debajo: `10:47` si es de hoy, `24/11 23:58` si es de otro día, y la fecha
  entera con los segundos en el tooltip. En la respuesta va en el renglón del
  contador de tools. Los chats de antes no tienen hora y no se les inventa una:
  abren como siempre. Lo dicho al Atom Echo la lleva al lado de su marca, y el
  chat que sigue a una tarea programada lleva las horas de la corrida.
- **El agente ve esas horas.** Cada mensaje del usuario le llega con su hora
  adelante, `[2026-11-25 10:47] hola`, y una línea fija en las instrucciones le
  explica el formato. Antes solo sabía la hora del momento, así que creía que
  toda la conversación pasaba «ahora»: no notaba que el usuario había vuelto
  dos horas después, o al otro día. El sello se agrega al armar el pedido: el
  texto guardado y el que se ve quedan limpios. Las respuestas del agente no lo
  llevan (lo copiaría en lo que escribe). También lo llevan el encargo de un
  subagente y el de una tarea programada.
- **La hora ya no va en el system prompt.** Iba en su primer renglón y cambiaba
  cada minuto; como el system es el principio del pedido, el caché del
  proveedor no podía reusar casi nunca lo que venía después, o sea el chat
  entero. Con la hora en cada mensaje, lo ya enviado no cambia más. (Lo pidió
  Zac con un diseño propio; esto último es lo único que se hizo distinto de lo
  que proponía, que era dejarla ahí actualizándose.)

## BlackCode 1.3.1 (2026-11-25)

- **Las tools no entran a la carpeta donde la app guarda lo suyo.** Un agente
  con solo las tools de archivos podía leer y editar los documentos de
  BlackCode: darse las tools de comandos (`agentes.json`), pasar la app a
  automático, prenderse «Let it act» o «Let voice act», o cambiar el comando de
  un servidor MCP. Ahora toda tool que toma una ruta (`fs_read`, `fs_write`,
  `fs_edit`, `fs_delete`, `sqlite_query`, `code_search`, `os_open`…) rechaza
  lo que cae en esa carpeta, también por una ruta relativa, un nombre corto o
  una junction, y antes de mostrar la tarjeta de permiso. Tampoco se puede
  mandar a la Papelera una carpeta que la contenga. La carpeta de trabajo y la
  de las imágenes, que están al lado, siguen como siempre. (Un agente con las
  tools de comandos sigue pudiendo lo que puede el usuario: esto cuida que
  tener menos no alcance para dárselas.)
- **`code_search` avisa cuando no encuentra nada por buscar como texto algo
  que parece una expresión regular.** Un agente buscó `encargo|Encargos`, le
  dio cero resultados (se buscó tal cual, con la barra) y concluyó que la
  palabra no estaba. Ahora ese «No matches» dice que se buscó como texto y que
  con `regex=true` es otra búsqueda. No cambia qué se busca: una `|` de verdad
  se sigue pudiendo buscar. La descripción de la tool también lo aclara.

## BlackCode 1.3.0 (2026-11-25)

- **Fijar chats.** El menú de un chat ofrece «Pin»: el chat sube al grupo
  «Pinned», arriba de todo, y los demás quedan debajo con el rótulo «Recent».
  Los dos grupos se pliegan y se acuerdan. Sin ningún chat fijado no hay ni
  grupo ni rótulos: la lista es la de siempre (y si se suelta el último fijado
  con «Recent» plegada, se abre sola: sin rótulo no habría cómo desplegarla).
  Las filas van sin ícono. Un chat de canal no se fija: ya tiene su grupo.
- **El ícono de la bandeja lleva el dibujo entero** del ícono común: el
  contorno, los rayos, los seis agentes y el núcleo, sin la baldosa. Hasta acá
  eran solo los puntos, porque a 16 px las líneas casi no se leen; Fran lo vio
  en su barra y lo quiso así igual. El kit de íconos acepta capas que se dejan
  ver a través (`alpha`): sin baldosa no hay contra qué aclarar una línea tenue.
- En Settings → Voice, un error viejo ya no queda pegado: «No voice sample
  set.» seguía en rojo después de elegir la muestra (Fran lo vio). Al cambiar
  el Python, la muestra o el modelo, el estado se limpia.

## BlackCode 1.2.0 (2026-11-25)

- **Arreglo: la 1.1.0 instalada no podía conectarse al Atom Echo.** Quedaba en
  «Connect failed during the Noise handshake: Unknown cipher». La conexión va
  cifrada con ChaCha20-Poly1305, que Node trae y Electron no (su `crypto` es
  BoringSSL). Las pruebas contra el Echo de verdad se habían hecho con node, y
  el humo usa un Echo de mentira: nada ejercitaba el cifrado adentro de la app.
  Ahora la app trae ese algoritmo (`main/chacha.cjs`, con `@noble/ciphers`) y
  el humo hace, dentro de Electron y con la librería de verdad, un saludo
  cifrado completo. Probado contra el Echo desde Electron.
- El nombre `.local` del Echo se busca tres veces (mDNS falló dos seguidas).
- **Los chats del Atom Echo van a un grupo «Channels», al fondo de la lista**
  de chats, como Fran lo tenía en Umbra: se pliega (y se acuerda), cada chat
  dice debajo cuándo fue, y el tacho de la cabeza los borra todos, preguntando.
  Sin contador. El ícono de las ondas reemplaza al micrófono, también en la
  marca del mensaje dicho.
- **El agente contesta en voz alta lo que se le dijo.** La respuesta de un
  turno de voz sale por los parlantes de la PC (el Atom Echo va sin parlante),
  con una voz clonada de una muestra que elige el usuario. La hace Qwen3-TTS en
  esta máquina, en otro Python del usuario (`motor/habla_motor.py`, con
  `faster-qwen3-tts`): el audio llega por tramos mientras se genera y empieza
  a sonar a medio segundo. Viene apagada.
- Solo se dice la respuesta de un turno de VOZ; lo tipeado se contesta por
  escrito. Al agente se le avisa que lo van a oír, así contesta en una o dos
  frases. Lo que se dice va sin markdown: el código, las tablas y los emojis
  se saltean, y una dirección web se dice «link».
- **Decir la palabra clave lo calla**: es la forma de interrumpirlo. Y si el
  turno queda esperando permiso, lo dice («Necesito tu permiso en la pantalla»).
- De la muestra se usa solo la huella de la voz, sin su texto: con el texto, una
  muestra en otro idioma le mezclaba los idiomas a la respuesta.
- Settings → Voice → Spoken answers: el Python de la voz, la muestra, el
  modelo (grande o chico), y «Say something» para probarla.
- El humo esperaba mal las condiciones asíncronas (una promesa siempre es
  verdadera): `until` ahora las espera.

## BlackCode 1.1.0 (2026-11-25)

- **Voz: darle una orden a un agente hablándole a un Atom Echo.** Se dice la
  palabra clave y lo que sigue entra a un chat como si se hubiera tipeado.
  BlackCode ocupa el lugar que tenía Home Assistant: se conecta al Echo por su
  API nativa de ESPHome (con `esphome-client`), se suscribe como asistente de
  voz, recibe el audio del micrófono por esa misma conexión, decide dónde
  termina la frase y le va avisando al Echo en qué va, que es lo que prende su
  LED. El firmware del Echo no se toca. BlackCode sale hacia el Echo: no abre
  ningún puerto. Viene apagada.
- **La frase se transcribe en esta máquina, con Whisper.** Corre en el Python
  del usuario (`motor/escucha_motor.py`, con `openai-whisper`): el modelo
  empieza a cargar apenas el Echo oye la palabra clave, mientras todavía se
  habla, y se suelta a los cinco minutos sin uso. El audio no se guarda. Lo que
  Whisper inventa en un silencio («Gracias.», los subtítulos de Amara) se
  descarta, y la palabra clave se saca del principio de la frase.
- **Lo dicho va a un chat de voz del agente elegido**, sin cambiar lo que hay
  en pantalla: un aviso dice qué se oyó y lleva al chat, y si nadie mira la
  ventana hay un aviso de Windows con la respuesta. El mensaje lleva un
  micrófono (es lo que Whisper entendió) y la fila del chat, otro. Tras media
  hora sin hablar, la frase siguiente abre un chat nuevo.
- **Un turno de voz va en manual** aunque la app esté en automático: lo que
  pide permiso muestra su tarjeta y espera. «Let voice act» lo deja correr
  solo; agendar una tarea y los servidores MCP con «preguntar» siguen
  preguntando. La frase la pudo haber dicho un video.
- Settings → Voice: la dirección del Echo, su llave (cifrada con
  `safeStorage`; la interfaz solo sabe si está puesta), el agente, el idioma,
  si Python tiene Whisper, y qué fue lo último que se oyó.

## BlackCode 1.0.1 (2026-11-25)

- En Skills, una skill que espera aprobación ya no lleva el canto amarillo a
  la izquierda: con el botón Review y su pie («proposed by an agent · not in
  use until you approve it») alcanza.
- En Tasks, «Run now» es un triángulo de play (era la flecha de mandar).
- **Una tabla pegada al renglón de arriba se dibuja como tabla.** Si el modelo
  la escribía sin una línea en blanco antes (un título en negrita y, debajo,
  la tabla), salía entera como texto, con sus barras. Fran lo vio en un chat.

## BlackCode 1.0.0 (2026-11-25) · núcleo 0.19.0

La primera versión 1.0: con las tareas programadas quedó hecho lo que estaba
planeado para la app (tools, memoria, skills, navegador, imágenes, MCP y tareas).

- **Tareas programadas.** Hay una pestaña nueva, **Tasks**: un pedido que un
  agente corre solo, una vez (en un rato o a una hora), cada tanto, o todos los
  días a una hora. Cada corrida deja su resultado en la bandeja de esa
  pestaña, con un aviso de Windows y un punto en la pestaña mientras haya
  algo sin leer. Un resultado se abre entero y se puede seguir en un chat.
- **La tarea es de un agente:** corre con su modelo, sus instrucciones, su
  memoria y sus skills, en un contexto nuevo (no recuerda ningún chat).
- **Sin nadie mirando, la corrida solo lee** (busca, lee archivos, notas y
  memoria). Cada tarea tiene un interruptor, «Let it act», para darle lo que
  tiene el agente. Ni con eso genera imágenes, usa un servidor MCP que
  pregunta antes de cada llamada, agenda otra tarea ni lanza subagentes.
- **Un agente puede crearlas** con la tool nueva `schedule` («recordame
  mañana», «todas las mañanas resumime…»), listarlas y borrarlas. Crear y
  borrar piden permiso **siempre**: también en automático y aunque el chat
  esté en «no preguntar más». Lo que crea un agente nace de solo lectura. Si
  un agente borra una tarea, la app avisa y deja deshacerlo.
- Una tarea no arranca mientras hay una respuesta en curso, ni corren dos a
  la vez. Lo que tocaba con la app cerrada corre **una vez** al abrirla, no
  una por cada vez que faltó. «Run now» corre una tarea ya sin mover su
  horario. Si el proveedor se queda cinco minutos sin mandar nada, la corrida
  se corta y lo dice. «Cada tanto» tiene un piso de 5 minutos.
- **BlackCode queda en la bandeja del sistema.** Cerrar la ventana ya no
  cierra la app: la esconde, y las tareas siguen corriendo. Vuelve con un clic
  en su ícono; se sale desde el menú de ese ícono. Se puede apagar en Settings
  («Keep running in the tray when the window is closed»).
- **Ícono de bandeja propio**, simplificado y sin baldosa: el núcleo y los
  seis agentes, sin el contorno ni los rayos, que a 16 px lo volvían un
  asterisco. Es claro u oscuro según la barra de Windows.
- **Núcleo 0.19.0:** `rad.start({ tray: { icon, tooltip, keep } })` le pone
  bandeja a cualquier app de Rad, y `rad.tray` la maneja (mostrar, esconder,
  salir). El actualizador avisa antes de instalar, porque cierra las ventanas
  antes de `before-quit`. Sin `tray`, todo sigue como estaba.
- La tool `schedule` va en un grupo nuevo, Tasks, que no es opcional: los
  agentes que tenían todas las tools la reciben.
- **Los agentes se pueden cambiar de lugar.** En la pestaña Agents cada uno
  tiene «Move up» y «Move down»; ese orden es también el del menú de agentes
  del chat.
- El tope de una pasada del humo pasó de 8 a 15 minutos: con MCP, la edición
  de imágenes y las tareas, la primera pasada ya tardaba 8.

## BlackCode 0.22.0 (2026-11-25)

- **Editar una imagen que ya existe.** `generate_image` tiene un parámetro
  nuevo, `input_images`: con él no genera de cero sino que cambia la imagen que
  se le pasa («que sea de noche», «sacale el fondo»). Con una imagen, la
  edita; con varias, la primera es la que se edita y las demás son de
  referencia (una persona, un estilo, un objeto para sumar). El resultado es
  una imagen nueva: la original queda como estaba.
- **Qué se puede editar:** una imagen de un archivo (una generada antes, o
  cualquiera del disco: PNG, JPEG o WebP) o **una que adjuntaste en el chat**.
  Los adjuntos no se copian al disco: cada uno tiene un número
  (`attachment:1`, `attachment:2`…, o `attachment:last`), que el agente ve
  al pie del mensaje que lo trajo.
- **Los modelos que editan son otra lista** (37 hoy en Venice), con su precio.
  En Settings, la tarjeta «Image generation» tiene un segundo selector, «Model
  for editing»; de fábrica va el de Venice (FireRed, $0.04 por edición).
- La tarjeta de permiso de una edición dice con qué modelo, **qué imágenes se
  le mandan a Venice** y cuánto sale (algunos modelos cobran aparte las
  imágenes de entrada).
- Se revisa antes de gastar: el tamaño de cada imagen (entre 256×256 y unos 33
  megapíxeles, menos de 25 MB), el formato, y cuántas acepta el modelo. Una
  edición cuenta para el tope de 8 imágenes por turno.
- En el registro del turno siguiente queda de qué imágenes salió cada edición.
- No usa `enhance_prompt` de Venice (cuesta aparte y tarda más): queda afuera.
- El PNG de mentira del humo pasó de 96 a 256 px, lo mínimo que se puede editar.

## BlackCode 0.21.0 (2026-11-25)

- **Servidores MCP.** En Settings hay una tarjeta nueva, «MCP servers», para
  conectar servidores que les suman tools a los agentes. Un servidor puede ser
  **local** (un comando que corre en esta PC: `npx`, `uvx`, `node`…) o
  **remoto** (una dirección https, con sus encabezados; sin OAuth). Se agregan
  con un formulario o pegando el bloque `mcpServers` de las instrucciones del
  servidor.
- **Cada servidor es un grupo de tools opcional**, apagado en todos los
  agentes: se prende por agente, desde el menú de tools del chat o el
  formulario del agente. Sus tools se llaman `mcp_<servidor>_<tool>` y llevan
  el ícono del enchufe.
- **«Ask before each call», por servidor.** Nace prendido: las tools de ese
  servidor piden permiso antes de cada llamada **también con la app en
  automático**, y la tarjeta dice de qué servidor es la tool. Apagado, siguen
  la regla general.
- **Las variables y los encabezados se guardan cifrados** (suelen ser llaves),
  como las llaves de las APIs. La interfaz solo recibe sus nombres: al cambiar
  un servidor el formulario muestra `<saved>` en lugar del valor, y dejarlo
  así conserva el guardado.
- La tarjeta dice cómo está cada servidor (conectando, conectado con cuántas
  tools, o por qué no conectó), y tiene un interruptor para apagarlo sin
  quitarlo y un botón para reconectar. Un servidor que se cae queda en error y
  deja de ofrecer sus tools. Apagado, los agentes que lo tenían lo conservan
  para cuando vuelva; quitado, se va también de los agentes.
- Topes: 80 tools por servidor (la tarjeta dice cuántas quedaron afuera), 900
  caracteres por descripción y 8000 por resultado. Lo que una tool dice de sí
  misma va marcado como texto del servidor, y la guía del agente le avisa que
  ese texto y sus resultados son datos, no instrucciones.
- Los subagentes no reciben tools de MCP.
- No hay todavía: OAuth, recursos ni prompts de MCP, ni aviso cuando un
  servidor cambia su lista de tools (hay que reconectarlo).
- Dependencia nueva: `@modelcontextprotocol/sdk` (el SDK oficial).

## BlackCode 0.20.2 (2026-11-25)

- El campo de las instrucciones de un agente (su system prompt) tiene el doble
  de alto: 14 renglones en vez de 7.

## BlackCode 0.20.1 (2026-11-25) · núcleo 0.18.1

- **Sobre la scrollbar de un campo de texto va la flecha**, no el cursor de
  texto. Era de Chromium, que le pone el cursor de texto al campo entero,
  barra incluida. Va en el núcleo: vale para todo campo de varios renglones de
  cualquier app de Rad.
- **Con un menú abierto, lo de atrás no se mueve.** Al abrir un desplegable
  (el de los modelos, por ejemplo) la página seguía scrolleando por debajo y
  el menú quedaba flotando lejos de su botón. También va en el núcleo.
- **About you** (Memory) tiene alto fijo, el doble que antes, y ya no trae la
  manija de la esquina para estirarlo. Lo que no entra, scrollea.
- Lo mismo los otros dos campos que tenían manija: el detalle de un recuerdo
  y las instrucciones de una skill quedan de alto fijo.

## BlackCode 0.20.0 (2026-11-25)

- **El nombre de un chat lo escribe un modelo.** Al mandar el primer mensaje,
  el chat se llama como siempre (el comienzo del mensaje) y, un momento
  después, un modelo le pone un título corto sobre el tema, en el idioma del
  mensaje.
- Es un pedido chico aparte, con un modelo barato: Claude Haiku para los
  agentes de Anthropic, el del propio agente para los de Venice. Lee el primer
  mensaje y los nombres de los adjuntos, no el resto de la conversación.
- Se nombra una sola vez. Un chat renombrado a mano no se toca. Si el pedido
  falla o tarda, queda el nombre de siempre.
- Se apaga en Settings, tarjeta «Chat names».

## BlackCode 0.19.1 (2026-11-25)

- **El agente ya no cree que inventó lo que dijo de una imagen.** En el turno
  siguiente a generar una, el agente solo veía que la tool había corrido, sin
  la ruta ni el formato que él mismo había dicho, y se retractaba. Ahora le
  queda anotado el prompt entero, el modelo, el formato, la semilla, si la
  miró y dónde se guardó.
- El registro de lo que corrió en turnos anteriores avisa, para todas las
  tools, que no trae lo que devolvió cada una.
- Cada imagen suelta queda con su semilla: la elige la app si el agente no
  pasó una, para poder repetirla o variarla después.

## BlackCode 0.19.0 (2026-11-25)

- **Generar imágenes.** Tool nueva, `generate_image`: el agente genera una
  imagen con Venice y queda en el chat, debajo de la llamada. Tocarla abre su
  menú: abrirla, guardarla, mostrarla en su carpeta.
- Usa la llave de Venice que ya está en Settings y cualquiera de los modelos de
  imagen que Venice ofrezca con esa llave. En Settings hay una tarjeta nueva,
  «Image generation», para elegir el modelo (dice cuánto sale cada imagen) y
  para el filtro de contenido adulto de Venice.
- **Gasta saldo de Venice en cada imagen.** Por eso viene apagada: se prende
  por agente, en el grupo Images. La tarjeta de permiso dice con qué modelo y
  cuánto sale, hay un tope de 8 imágenes por turno, y los subagentes no la
  tienen.
- Las imágenes se guardan como archivos, no adentro del chat: un chat con
  muchas imágenes no se vuelve pesado.
- El agente no ve lo que generó salvo que lo pida: no gasta tokens en mirar.
- Son 33 tools en 14 grupos.

## BlackCode 0.18.2 (2026-11-25)

- **Ir al final del chat.** Un botón redondo aparece sobre el campo para
  escribir cuando se subió a leer; tocarlo baja andando hasta lo último y deja
  el chat otra vez pegado a lo que llega. Es el de NeonCode.
- **El botón de la carpeta del chat es un toggle.** Tocarlo con el menú abierto
  lo cierra. Antes se cerraba y se volvía a abrir de un salto.

## BlackCode 0.18.1 (2026-11-25)

- **El pin de las notas**, igual que la estrella de los marcadores: en una nota
  fijada se rellena, y nada más. El botón ya no queda remarcado.

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
