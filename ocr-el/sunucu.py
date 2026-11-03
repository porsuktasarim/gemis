"""
GEMİS el yazısı OCR servisi.

PaddleOCR modellerini ONNX Runtime ile (RapidOCR) çalıştırır. Modeller pakete gömülüdür;
çalışırken internet gerekmez. Görüntüler yalnızca bellekte işlenir, diske yazılmaz.

POST /oku?mod=satir|blok   gövde: görüntü baytları (PNG/JPEG)
  satir: tek satır tanıma (algılama yok) - küçük hücreler için; birkaç ön işleme çeşidi "adaylar"da döner
  blok : önce metin bölgeleri algılanır, sonra her biri tanınır
  yanıt: {"metin": "...", "parcalar": [{"metin": "...", "guven": 0.97}]}
GET /saglik  ->  {"ok": true, "motor": "..."}
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

try:
    from importlib.metadata import version
    SURUM = version("rapidocr_onnxruntime")
except Exception:  # pragma: no cover
    SURUM = "?"

MOTOR = RapidOCR()
ENBUYUK = 15 * 1024 * 1024
# Yalnızca tanıyıcı (algılamasız tek satır). Sürüme göre adı değişiyor.
TANIYICI = getattr(MOTOR, "text_rec", None) or getattr(MOTOR, "text_recognizer")


def _tani(img):
    sonuc = TANIYICI([img])
    liste = sonuc[0] if isinstance(sonuc, tuple) else sonuc
    if not liste:
        return None
    metin, guven = liste[0][0], float(liste[0][1])
    return {"metin": metin.strip(), "guven": guven, "y": 0.0, "x": 0.0} if metin.strip() else None


def satir_tani(img):
    """Tek satırı birkaç ön işleme çeşidiyle okur; her çeşidin sonucu aday olarak döner.
    El yazısında ince çizgiler için kenar boşluğu + kalınlaştırma (erode) çoğu zaman daha iyi sonuç verir."""
    gri = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    bosluk = cv2.copyMakeBorder(gri, 30, 30, 40, 40, cv2.BORDER_CONSTANT, value=255)
    kalin = cv2.erode(bosluk, np.ones((3, 3), np.uint8), iterations=1)
    adaylar = []
    for v in (gri, kalin, bosluk):
        r = _tani(cv2.cvtColor(v, cv2.COLOR_GRAY2BGR))
        if r and r["metin"] not in [a["metin"] for a in adaylar]:
            adaylar.append(r)
    return adaylar


def _parcalar(sonuc):
    """RapidOCR çıktısı sürüme göre [[kutu, metin, guven]] ya da [[metin, guven]] olabilir."""
    cikti = []
    for s in sonuc or []:
        if len(s) >= 3 and isinstance(s[1], str):
            cikti.append({"metin": s[1], "guven": float(s[2]), "y": float(min(p[1] for p in s[0])), "x": float(min(p[0] for p in s[0]))})
        elif len(s) >= 2 and isinstance(s[0], str):
            cikti.append({"metin": s[0], "guven": float(s[1]), "y": 0.0, "x": 0.0})
    # Okuma sırası: yukarıdan aşağı, soldan sağa
    cikti.sort(key=lambda p: (round(p["y"] / 20), p["x"]))
    return cikti


def oku(veri, mod):
    img = cv2.imdecode(np.frombuffer(veri, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("görüntü çözülemedi")
    if mod == "satir":
        parcalar = satir_tani(img)
    else:
        sonuc = MOTOR(img)
        parcalar = _parcalar(sonuc[0] if isinstance(sonuc, tuple) else sonuc)
    if mod == "satir":
        # parcalar: aynı satırın aday okumaları (ilk sıradaki ilk çeşit); metin: ilk aday
        return {"metin": parcalar[0]["metin"] if parcalar else "", "adaylar": [p["metin"] for p in parcalar],
                "parcalar": [{"metin": p["metin"], "guven": round(p["guven"], 3)} for p in parcalar]}
    return {"metin": "\n".join(p["metin"] for p in parcalar), "adaylar": [],
            "parcalar": [{"metin": p["metin"], "guven": round(p["guven"], 3)} for p in parcalar]}


class Isleyici(BaseHTTPRequestHandler):
    def _yanit(self, kod, veri):
        govde = json.dumps(veri, ensure_ascii=False).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        self.end_headers()
        self.wfile.write(govde)

    def do_GET(self):
        if urlparse(self.path).path == "/saglik":
            self._yanit(200, {"ok": True, "motor": f"PaddleOCR (RapidOCR {SURUM})"})
        else:
            self._yanit(404, {"hata": "yok"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/oku":
            return self._yanit(404, {"hata": "yok"})
        uzunluk = int(self.headers.get("Content-Length") or 0)
        if not uzunluk or uzunluk > ENBUYUK:
            return self._yanit(400, {"hata": "geçersiz boyut"})
        mod = (parse_qs(u.query).get("mod") or ["satir"])[0]
        try:
            self._yanit(200, oku(self.rfile.read(uzunluk), mod))
        except Exception as e:  # noqa: BLE001
            self._yanit(500, {"hata": str(e)})

    def log_message(self, *a):  # istek günlüğünü kapat
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"GEMİS el yazısı OCR: PaddleOCR (RapidOCR {SURUM}) :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Isleyici).serve_forever()
