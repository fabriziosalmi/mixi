# Build stage for React frontend + Rust/Wasm
FROM node:22-alpine AS frontend-builder

# Install Rust toolchain + wasm-pack for mixi-core Wasm compilation
RUN apk add --no-cache curl gcc musl-dev && \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable && \
    source $HOME/.cargo/env && \
    rustup target add wasm32-unknown-unknown && \
    cargo install wasm-pack

ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Final stage for Python FastAPI + yt-dlp backend
FROM python:3.11-slim
WORKDIR /app

# Install ffmpeg for yt-dlp to process audio properly
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy python requirements and install
COPY api/requirements.txt ./api/
RUN pip install --no-cache-dir -r api/requirements.txt

# Copy built frontend
COPY --from=frontend-builder /app/dist ./dist

# Copy backend code
COPY api/ ./api/

# Expose API port
EXPOSE 8000

# Start Uvicorn from the API directory
WORKDIR /app/api
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
