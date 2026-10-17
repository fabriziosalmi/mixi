# Build stage for React frontend + Rust/Wasm
FROM node:22-alpine AS frontend-builder

# Install Rust toolchain + wasm-pack + git for mixi-core Wasm compilation
# git is needed for Cargo to fetch git dependencies (open-bpm)
#
# The toolchain and wasm-pack are pinned so two builds of one commit compile
# with the same compiler; "stable" moved under every build. The rustup download
# is retried because a single TLS reset on static.rust-lang.org failed the
# main build of 521763a. The installer is saved before it runs: piped into sh,
# a failed download is an empty script that exits 0.
ARG RUST_VERSION=1.99.1
ARG WASM_PACK_VERSION=0.15.0
RUN apk add --no-cache curl gcc musl-dev git && \
    for attempt in 1 2 3; do \
      curl --proto '=https' --tlsv1.2 -sSf --retry 3 -o /tmp/rustup-init.sh https://sh.rustup.rs && \
      sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "$RUST_VERSION" && break; \
      [ "$attempt" = 3 ] && exit 1; sleep 15; \
    done && \
    rm -f /tmp/rustup-init.sh && \
    source $HOME/.cargo/env && \
    rustup target add wasm32-unknown-unknown && \
    cargo install wasm-pack --version "$WASM_PACK_VERSION" --locked

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
