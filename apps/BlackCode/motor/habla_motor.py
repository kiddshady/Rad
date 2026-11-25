"""BlackCode: el motor del habla. Un proceso que carga Qwen3-TTS una vez y dice lo que le piden, con una voz clonada.

Habla JSON por líneas: lee pedidos por stdin y escribe eventos por stdout.

  pedido  {"op": "cargar", "modelo", "referencia"}     el modelo entra a memoria y aprende la voz de la muestra
              "modelo": el id en Hugging Face (Qwen/Qwen3-TTS-12Hz-1.7B-Base)
              "referencia": un WAV con la voz a clonar (solo se usa su huella: sin el texto de la muestra)
          {"op": "decir", "id", "texto", "idioma"}      genera y va entregando el audio por tramos
          {"op": "callar", "id"}                        ese pedido ya no se dice: si se está generando, se corta
          {"op": "salir"}
  evento  {"ev": "arranco"}                             el proceso está vivo
          {"ev": "listo", "gpu"}                        torch y el motor importados
          {"ev": "cargando", "modelo"}
          {"ev": "cargado", "modelo", "tardo"}
          {"ev": "audio", "id", "n", "sr", "pcm"}       un tramo: PCM de 16 bits, mono, en base64
          {"ev": "fin", "id", "dur", "tardo", "primero", "callado"}
          {"ev": "error", "id", "msg"}

«callar» tiene que llegar mientras se genera: entre un tramo y el siguiente se
mira si entró algo por stdin, SIN quedarse esperando (en Windows, con
PeekNamedPipe). No se usa un hilo que lea stdin: con una lectura bloqueada en
otro hilo, Windows deja colgado al que carga el modelo. El audio no toca el disco.
"""
import base64
import collections
import json
import os
import sys
import time


class Entrada:
    """Las líneas de stdin, leídas a mano del descriptor: esperando o sin esperar."""

    def __init__(self):
        self.fd = sys.stdin.fileno()
        self.resto = b""
        self.cerrada = False
        if os.name == "nt":
            import ctypes
            import msvcrt
            self._k32 = ctypes.windll.kernel32
            self._ct = ctypes
            self._mano = msvcrt.get_osfhandle(self.fd)

    def _hay(self):
        if os.name == "nt":
            n = self._ct.c_ulong(0)
            ok = self._k32.PeekNamedPipe(self._ct.c_void_p(self._mano), None, 0, None, self._ct.byref(n), None)
            if not ok:   # el otro lado cerró (o no es un pipe): hay que leer para enterarse
                return True
            return n.value > 0
        import select
        return bool(select.select([self.fd], [], [], 0)[0])

    def _sacar(self):
        i = self.resto.find(b"\n")
        if i < 0:
            return None
        linea, self.resto = self.resto[:i], self.resto[i + 1:]
        return linea.decode("utf-8", "replace").strip()

    def linea(self, esperar):
        """La próxima línea; None si no hay (sin esperar) o si se cerró la entrada."""
        while True:
            linea = self._sacar()
            if linea is not None:
                return linea
            if self.cerrada or (not esperar and not self._hay()):
                return None
            trozo = os.read(self.fd, 65536)
            if not trozo:
                self.cerrada = True
                return None
            self.resto += trozo


def decir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    decir({"ev": "arranco"})

    import numpy as np
    import torch
    from faster_qwen3_tts import FasterQwen3TTS

    cuda = torch.cuda.is_available()
    decir({"ev": "listo", "gpu": torch.cuda.get_device_name(0) if cuda else None})

    entrada = Entrada()
    pedidos = collections.deque()   # lo que llegó y todavía no se atendió
    callados = set()                # ids que ya no hay que decir

    def tomar(esperar):
        """Pasa a `pedidos` lo que haya en stdin. «callar» se anota en el acto."""
        while True:
            linea = entrada.linea(esperar and not pedidos)
            if linea is None:
                if entrada.cerrada:
                    pedidos.append({"op": "salir"})
                return
            if not linea:
                continue
            try:
                op = json.loads(linea)
            except ValueError:
                continue
            if op.get("op") == "callar":
                if op.get("id") is not None:
                    callados.add(op["id"])
                continue
            pedidos.append(op)
            esperar = False

    estado = {"modelo": None, "id": None, "referencia": None}

    def cargar(op):
        nombre = op.get("modelo") or "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
        referencia = op.get("referencia") or estado["referencia"]
        if not referencia:
            raise ValueError("no voice sample set")
        if estado["modelo"] is None or estado["id"] != nombre:
            t0 = time.time()
            decir({"ev": "cargando", "modelo": nombre})
            estado["modelo"] = None
            if cuda:
                torch.cuda.empty_cache()
            m = FasterQwen3TTS.from_pretrained(nombre)
            try:
                m.warmup(prefill_len=100)
            except Exception:   # sin calentar anda igual: la primera frase tarda un poco más
                pass
            estado["modelo"], estado["id"] = m, nombre
            decir({"ev": "cargado", "modelo": nombre, "tardo": time.time() - t0})
        estado["referencia"] = referencia
        return estado["modelo"]

    def hablar(op):
        ident = op["id"]
        texto = (op.get("texto") or "").strip()
        if not texto:
            decir({"ev": "fin", "id": ident, "dur": 0, "tardo": 0, "primero": None, "callado": False})
            return
        m = cargar(op)
        t0 = time.time()
        primero = None
        muestras = 0
        sr = 24000
        n = 0
        callado = False
        for audio, sr, _ in m.generate_voice_clone_streaming(
            text=texto, language=op.get("idioma") or "Spanish",
            ref_audio=estado["referencia"], ref_text="", xvec_only=True, chunk_size=8,
        ):
            tomar(False)   # ¿lo callaron mientras se generaba este tramo?
            if ident in callados:
                callado = True
                break
            onda = np.asarray(audio, dtype=np.float32).reshape(-1)
            if primero is None:
                primero = time.time() - t0
            muestras += len(onda)
            pcm = (np.clip(onda, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            decir({"ev": "audio", "id": ident, "n": n, "sr": int(sr), "pcm": base64.b64encode(pcm).decode("ascii")})
            n += 1
        callados.discard(ident)
        decir({"ev": "fin", "id": ident, "dur": muestras / sr, "tardo": time.time() - t0, "primero": primero, "callado": callado})

    while True:
        if not pedidos:
            tomar(True)
        if not pedidos:
            continue
        op = pedidos.popleft()
        if op.get("op") == "salir":
            break
        try:
            if op.get("op") == "cargar":
                cargar(op)
            elif op.get("op") == "decir":
                if op.get("id") in callados:   # lo callaron antes de que le tocara
                    callados.discard(op.get("id"))
                    decir({"ev": "fin", "id": op.get("id"), "dur": 0, "tardo": 0, "primero": None, "callado": True})
                else:
                    hablar(op)
        except Exception as err:  # el motor sigue vivo para la próxima frase
            decir({"ev": "error", "id": op.get("id"), "msg": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
