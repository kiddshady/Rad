"""BlackCode: el motor de la palabra clave. Escucha «okay zac» en el audio del micrófono de la PC.

Es el mismo modelo que corre el Atom Echo en su firmware (microWakeWord): acá
lo corre pymicro-wakeword, que trae su propio TensorFlow Lite y pesa poco. El
modelo es el .json del usuario con su .tflite al lado (el primer argumento).

Lee audio crudo por stdin (16 kHz, mono, 16 bits, sin encabezado: lo que llega
del micrófono, de a tramos) y escribe eventos JSON por líneas en stdout:

  {"ev": "listo", "palabra": "okay zac"}   el modelo está cargado
  {"ev": "oida", "p": 0.99}                se dijo la palabra clave
  {"ev": "error", "msg": "..."}            no se pudo cargar (y sale)

Después de oírla, el modelo vuelve a cero: una sola palabra no avisa dos veces.
Sale cuando se cierra stdin. El audio no se guarda en ningún lado.
"""
import json
import sys


def decir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        from pymicro_wakeword import MicroWakeWord, MicroWakeWordFeatures
        modelo = MicroWakeWord.from_config(sys.argv[1])
        rasgos = MicroWakeWordFeatures()
    except Exception as err:  # falta el paquete, o el modelo no se puede leer
        decir({"ev": "error", "msg": f"{type(err).__name__}: {err}"})
        return
    decir({"ev": "listo", "palabra": modelo.wake_word})
    entrada = sys.stdin.buffer
    while True:
        tramo = entrada.read1(4096)
        if not tramo:
            break
        for f in rasgos.process_streaming(tramo):
            p = modelo.process_streaming_prob(f)
            if p is not None and p > modelo.probability_cutoff:
                decir({"ev": "oida", "p": round(float(p), 3)})
                modelo.reset()
                rasgos.reset()
                break


if __name__ == "__main__":
    main()
