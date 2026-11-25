"""BlackCode: el motor de escucha. Un proceso que carga Whisper una vez y transcribe frases cortas.

Habla JSON por líneas: lee pedidos por stdin y escribe eventos por stdout.

  pedido  {"op": "cargar", "modelo", "dispositivo"}      el modelo entra a memoria (no contesta si ya estaba)
          {"op": "transcribir", "id", "pcm", "idioma", "prompt", "modelo", "dispositivo"}
              "pcm": audio de 16 kHz, mono, 16 bits, en base64 (no pasa por ffmpeg ni por el disco)
              "dispositivo": "cpu" deja la placa libre; cualquier otra cosa la usa si hay
          {"op": "salir"}
  evento  {"ev": "arranco"}                              el proceso está vivo
          {"ev": "listo", "dispositivo", "gpu"}          torch y whisper importados
          {"ev": "cargando", "modelo", "dispositivo"}    el modelo entra a memoria
          {"ev": "cargado", "modelo", "dispositivo", "tardo"}
          {"ev": "hecho", "id", "dur", "tardo", "idioma", "segs"}
          {"ev": "error", "id", "msg"}

Cada segmento lleva t (texto) y las medidas con las que se descarta lo que
Whisper inventa en un silencio: lp (avg_logprob), ns (no_speech_prob) y cr
(compression_ratio). El audio no se guarda en ningún lado.
"""
import base64
import json
import sys
import time


def decir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    decir({"ev": "arranco"})

    import numpy as np
    import torch
    import whisper

    cuda = torch.cuda.is_available()
    decir({"ev": "listo", "dispositivo": "cuda" if cuda else "cpu",
           "gpu": torch.cuda.get_device_name(0) if cuda else None})

    modelos = {}

    def cargar(op):
        nombre = op.get("modelo") or "large-v3-turbo"
        dispositivo = "cuda" if cuda and op.get("dispositivo") != "cpu" else "cpu"
        clave = (nombre, dispositivo)
        if clave not in modelos:
            t0 = time.time()
            decir({"ev": "cargando", "modelo": nombre, "dispositivo": dispositivo})
            modelos.clear()   # uno solo en memoria: la VRAM es de todos
            if cuda:
                torch.cuda.empty_cache()
            modelos[clave] = whisper.load_model(nombre, device=dispositivo)
            decir({"ev": "cargado", "modelo": nombre, "dispositivo": dispositivo, "tardo": time.time() - t0})
        return modelos[clave], dispositivo

    def transcribir(op):
        t0 = time.time()
        crudo = base64.b64decode(op.get("pcm") or "")
        audio = np.frombuffer(crudo[: len(crudo) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
        modelo, dispositivo = cargar(op)
        r = modelo.transcribe(
            audio,
            language=op.get("idioma") or None,
            fp16=dispositivo == "cuda",
            condition_on_previous_text=False,
            initial_prompt=op.get("prompt") or None,
            verbose=None,
        )
        segs = [{
            "t": s["text"].strip(),
            "lp": round(float(s["avg_logprob"]), 3), "ns": round(float(s["no_speech_prob"]), 3),
            "cr": round(float(s["compression_ratio"]), 2),
        } for s in r["segments"] if s["text"].strip()]
        decir({"ev": "hecho", "id": op["id"], "dur": len(audio) / 16000, "tardo": time.time() - t0,
               "idioma": r.get("language"), "segs": segs})

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            op = json.loads(linea)
        except ValueError:
            continue
        if op.get("op") == "salir":
            break
        try:
            if op.get("op") == "cargar":
                cargar(op)
            elif op.get("op") == "transcribir":
                transcribir(op)
        except Exception as err:  # el motor sigue vivo para la próxima frase
            decir({"ev": "error", "id": op.get("id"), "msg": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
