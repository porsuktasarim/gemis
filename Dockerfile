FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-tur \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
ENV PORT=3000 UPLOAD_DIR=/data/uploads
EXPOSE 3000
CMD ["node", "src/server.js"]
