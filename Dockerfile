# Build stage for React frontend
FROM node:22-alpine AS frontend-builder
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
