'use strict';

// El pedido al modelo. El renderer manda el pedido armado (proveedor, modelo,
// instrucciones del agente y el chat hasta ahí) y el texto vuelve de a poco
// por el puente:
//
//   rad.invoke('chat:enviar', { id, proveedor, modelo, instrucciones, mensajes })
//   rad.on('chat:evento', ({ id, tipo, … }))
//     tipo 'pensando'            el modelo está pensando, todavía sin texto
//     tipo 'texto'  { texto }    un pedazo más de la respuesta
//     tipo 'fin'    { motivo }   'fin' | 'frenado' | 'largo' | 'rechazo'
//     tipo 'error'  { mensaje }  no hubo respuesta, y por qué
//   rad.invoke('chat:frenar', id)
//
//   rad.invoke('chat:modelos')   los proveedores con sus modelos
//   rad.on('chat:modelos', …)    la lista cambió (llegó la de Venice)
//
// Sin herramientas: el modelo solo conversa.

const anthropic = require('./anthropic.cjs');
const venice = require('./venice.cjs');
const simulado = require('./simulado.cjs');

const NOMBRES = { anthropic: 'Anthropic', venice: 'Venice' };
const RESPONDER = { anthropic: anthropic.responder, venice: venice.responder };
const ROLES = new Set(['user', 'assistant']);

// La lista de Venice se guarda (en un documento del main) para no pedirla en
// cada arranque: se vuelve a pedir si tiene más de unas horas.
const DOC_VENICE = '_venice_modelos';
const VENCE_MS = 6 * 60 * 60 * 1000;
const ESPERA_MODELOS_MS = 8000;

function limpiar(pedido) {
  const { id, proveedor = 'anthropic', modelo, instrucciones, mensajes } = pedido ?? {};
  if (typeof id !== 'string' || !id) throw new Error('[daimon] el pedido no trae id');
  if (!RESPONDER[proveedor]) throw new Error(`[daimon] proveedor desconocido: ${JSON.stringify(proveedor)}`);
  if (typeof modelo !== 'string' || !modelo) throw new Error('[daimon] el pedido no trae modelo');
  if (!Array.isArray(mensajes) || !mensajes.length) throw new Error('[daimon] el pedido no trae mensajes');
  const lista = mensajes
    .filter((m) => m && ROLES.has(m.rol) && typeof m.texto === 'string' && m.texto.trim())
    .map((m) => ({ rol: m.rol, texto: m.texto }));
  if (!lista.length || lista[0].rol !== 'user') throw new Error('[daimon] el chat tiene que empezar con un mensaje del usuario');
  return { id, proveedor, modelo, instrucciones: typeof instrucciones === 'string' ? instrucciones.trim() : '', mensajes: lista };
}

function wire(rad, { llave }) {
  const activos = new Map(); // id del pedido -> AbortController

  // ---------- Los modelos ----------
  const veniceGuardado = () => (llave.SIMULADO ? simulado.VENICE : rad.store.read(DOC_VENICE) ?? { lista: [], inicial: '' });
  const proveedores = () => {
    const v = veniceGuardado();
    return {
      proveedores: [
        { id: 'anthropic', nombre: NOMBRES.anthropic, modelos: anthropic.MODELOS, inicial: anthropic.MODELO_INICIAL },
        { id: 'venice', nombre: NOMBRES.venice, modelos: v.lista ?? [], inicial: v.inicial ?? '' },
      ],
    };
  };

  // Trae la lista de Venice y avisa. Solo si hay una llave de Venice: sin
  // ella nadie va a usar esos modelos, y la app no llama a nadie por las dudas.
  let trayendo = false;
  async function traerVenice({ forzar = false } = {}) {
    if (llave.SIMULADO || trayendo) return;
    const key = llave.leer(rad.store, 'venice');
    if (!key) return;
    const guardado = rad.store.read(DOC_VENICE);
    if (!forzar && guardado?.lista?.length && Date.now() - (guardado.cuando ?? 0) < VENCE_MS) return;
    trayendo = true;
    try {
      const nuevo = await venice.modelos({ key, signal: AbortSignal.timeout(ESPERA_MODELOS_MS) });
      if (nuevo.lista.length) {
        await rad.store.write(DOC_VENICE, { ...nuevo, cuando: Date.now() });
        rad.send('chat:modelos', proveedores());
      }
    } catch (err) {
      console.warn(`[daimon] no se pudo traer la lista de modelos de Venice: ${err.message}`);
    } finally {
      trayendo = false;
    }
  }

  rad.handle('chat:modelos', () => {
    traerVenice(); // en segundo plano: el arranque no espera a la red
    return proveedores();
  });

  // ---------- El pedido ----------
  rad.handle('chat:enviar', (crudo) => {
    const pedido = limpiar(crudo);
    const avisar = (tipo, extra = {}) => rad.send('chat:evento', { id: pedido.id, tipo, ...extra });
    const control = new AbortController();
    activos.set(pedido.id, control);

    const opciones = {
      signal: control.signal,
      onPensando: () => avisar('pensando'),
      onTexto: (texto) => avisar('texto', { texto }),
    };
    let trabajo;
    if (llave.SIMULADO) {
      trabajo = simulado.responder(pedido, opciones);
    } else {
      const key = llave.leer(rad.store, pedido.proveedor);
      trabajo = key
        ? RESPONDER[pedido.proveedor](pedido, { ...opciones, key })
        : Promise.reject(new Error(`Falta la llave de ${NOMBRES[pedido.proveedor]}. Pegala en Ajustes y probá de nuevo.`));
    }

    // No se espera acá: el invoke vuelve enseguida y lo demás llega por eventos.
    trabajo
      .then((fin) => avisar('fin', fin), (err) => avisar('error', { mensaje: err.message }))
      .finally(() => activos.delete(pedido.id));
    return { ok: true };
  });

  rad.handle('chat:frenar', (id) => {
    activos.get(id)?.abort();
    return { ok: true };
  });

  return {
    // Cambió una llave: si es la de Venice, su lista de modelos se pide ya.
    alCambiarLlave: (proveedor) => { if (proveedor === 'venice') traerVenice({ forzar: true }); },
  };
}

module.exports = { wire };
