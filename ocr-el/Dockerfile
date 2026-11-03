# GEMİS el yazısı OCR servisi: PaddleOCR modelleri (PP-OCRv4) ONNX Runtime ile, RapidOCR üzerinden.
# Modeller pip paketinin içinde gelir; çalışırken internet gerekmez.
FROM python:3.11-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sunucu.py .
# İlk istekte gecikme olmasın diye modeller derleme sırasında bir kez yüklenip denetlenir
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR(); print('modeller hazır')"
ENV PORT=8000 OMP_NUM_THREADS=2
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/saglik', timeout=4).status == 200 else 1)"
CMD ["python", "sunucu.py"]
