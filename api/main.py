# Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
#
# This file is part of MIXI.
# MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
# You may not use this file for commercial purposes without explicit permission.
# For commercial licensing, contact: fabrizio.salmi@gmail.com

# ─────────────────────────────────────────────────────────────
# Mixi – Audio Stream Proxy
#
# FastAPI micro-backend that uses yt-dlp to resolve SoundCloud
# (or YouTube) URLs into direct CDN streams and proxies the
# bytes to the browser, bypassing CORS.
#
# Logging uses `rich` for colour-coded, human-readable output
# that clearly separates lifecycle events from request traffic.
#
# Setup:
#   pip install fastapi uvicorn yt-dlp httpx rich
#
# Run (standalone):
#   uvicorn main:app --reload --port 8000
#
# Run (via Mixi launcher):
#   npm run dev          ← starts both UI + API with concurrently
# ─────────────────────────────────────────────────────────────

from __future__ import annotations

import logging
import time
from typing import AsyncGenerator

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

import httpx
import yt_dlp
from fastapi import FastAPI, Query, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from rich.console import Console
from rich.logging import RichHandler
from rich.theme import Theme

# ── Rich console setup ───────────────────────────────────────
#
# Custom theme so our log tags are instantly recognisable in
# a crowded terminal alongside Vite/HMR output.

mixi_theme = Theme(
    {
        "startup": "bold green",
        "request": "bold cyan",
        "ytdlp": "bold yellow",
        "success": "bold green",
        "error": "bold red",
        "dim": "dim white",
    }
)

console = Console(theme=mixi_theme)

# ── Configure Python logging to use Rich ─────────────────────
#
# We replace the root handler so that *our* log calls go through
# Rich, while silencing the noisy uvicorn access logger to keep
# the terminal clean.  Uvicorn's own startup banner still shows.

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%H:%M:%S]",
    handlers=[
        RichHandler(
            console=console,
            rich_tracebacks=True,       # pretty tracebacks on errors
            tracebacks_show_locals=True, # show local vars in tracebacks
            markup=True,                 # allow [bold], [cyan] etc.
            show_path=False,             # no file:line noise
        )
    ],
)

# Quiet down uvicorn's per-request access log – our own logs
# are more informative and less noisy.
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.INFO)

logger = logging.getLogger("mixi.api")

# ── App setup ─────────────────────────────────────────────────

app = FastAPI(title="Mixi Stream Proxy", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:[0-9]+)?|file://.*|https://([a-zA-Z0-9-]+\.)?github\.io|https://(www\.)?mixidaw\.com)$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type", "X-Track-Title"],
)

# ── WebSocket bridge for MCP / AI agent ──────────────────────
#
# The browser connects here.  The MCP server (or any external
# controller) sends commands via the REST endpoint /api/command
# which are relayed to the browser through the WebSocket.
#
# State snapshots flow back: browser → WebSocket → stored in
# _latest_state so the MCP server can poll it.

_browser_ws: WebSocket | None = None
_latest_state: dict | None = None
_pending_responses: dict[str, asyncio.Future] = {}


@app.websocket("/ws/mixer")
async def mixer_websocket(ws: WebSocket):
    """
    Single-client WebSocket for the browser bridge.
    Receives state snapshots, relays commands from the MCP server.
    """
    global _browser_ws, _latest_state
    
    # Preempt any zombie connection that didn't clean up properly
    if _browser_ws is not None:
        try:
            await _browser_ws.close()
        except:
            pass

    await ws.accept()
    _browser_ws = ws
    logger.info("[request]Browser connesso via WebSocket[/request]")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "state":
                # State snapshot from browser — cache it.
                _latest_state = msg.get("data")

            elif msg_type == "response":
                # Response to a command we relayed.
                msg_id = msg.get("id")
                if msg_id and msg_id in _pending_responses:
                    _pending_responses[msg_id].set_result(msg)

    except WebSocketDisconnect:
        logger.info("[dim]Browser disconnesso dal WebSocket[/dim]")
    finally:
        _browser_ws = None
        # Drain any pending command futures — the browser is gone.
        for cmd_id, fut in list(_pending_responses.items()):
            if not fut.done():
                fut.set_result({"type": "response", "id": cmd_id, "ok": False, "error": "Browser disconnected"})
        _pending_responses.clear()


async def send_command_to_browser(
    action: str, args: list, timeout: float = 5.0
) -> dict:
    """
    Send a command to the browser and wait for the response.
    Used by the REST /api/command endpoint and the MCP server.
    """
    if _browser_ws is None:
        raise HTTPException(status_code=503, detail="No browser connected")

    import uuid
    cmd_id = str(uuid.uuid4())[:8]
    cmd = {"type": "command", "id": cmd_id, "action": action, "args": args}

    future: asyncio.Future = asyncio.get_running_loop().create_future()
    _pending_responses[cmd_id] = future

    try:
        await _browser_ws.send_text(json.dumps(cmd))
        result = await asyncio.wait_for(future, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Browser did not respond")
    finally:
        _pending_responses.pop(cmd_id, None)


@app.post("/api/command")
async def command_endpoint(body: dict):
    """
    REST endpoint for sending commands to the mixer.
    Body: { "action": "setCrossfader", "args": [0.7] }

    This is the simplest way for an external script or MCP
    server to control Mixi without speaking WebSocket directly.
    """
    action = body.get("action")
    args = body.get("args", [])

    if not action or not isinstance(action, str):
        raise HTTPException(status_code=400, detail="Missing 'action' field")
    if not isinstance(args, list):
        raise HTTPException(status_code=400, detail="'args' must be a list")

    logger.info(
        "[request]MCP Command:[/request] [bold]%s[/bold](%s)",
        action,
        ", ".join(str(a) for a in args),
    )

    result = await send_command_to_browser(action, args)
    return result


@app.get("/api/state")
async def state_endpoint():
    """
    Returns the latest mixer state snapshot.
    The MCP server polls this to get situational awareness.
    """
    if _latest_state is None:
        raise HTTPException(
            status_code=503,
            detail="No state available — browser not connected",
        )
    return _latest_state

# ── yt-dlp configuration ─────────────────────────────────────

YDL_OPTS: dict = {
    "format": "bestaudio",
    "quiet": True,
    "no_warnings": True,
    "extract_flat": False,
    "skip_download": True,
}

YDL_DOWNLOAD_OPTS: dict = {
    "format": "bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio",
    "quiet": True,
    "no_warnings": True,
    "extract_flat": False,
    "outtmpl": "-",              # stdout
    "logtostderr": True,
    "postprocessors": [{
        "key": "FFmpegExtractAudio",
        "preferredcodec": "mp3",
        "preferredquality": "192",
    }],
}

# ── HTTP client (singleton) ──────────────────────────────────

_http_client: httpx.AsyncClient | None = None


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10),
        )
    return _http_client


# ── Lifecycle events ──────────────────────────────────────────


@app.on_event("startup")
async def _on_startup() -> None:
    console.print()
    console.rule("[startup]  MIXI AUDIO API  [/startup]", style="green")
    console.print(
        "  [startup]Proxy attivo su[/startup]  "
        "[bold white]http://localhost:8000[/bold white]",
    )
    console.print(
        "  [dim]Stream:[/dim]       GET  /api/stream?url=…",
    )
    console.print(
        "  [dim]Command:[/dim]      POST /api/command",
    )
    console.print(
        "  [dim]State:[/dim]        GET  /api/state",
    )
    console.print(
        "  [dim]WebSocket:[/dim]    WS   /ws/mixer",
    )
    console.print(
        "  [dim]Health:[/dim]       GET  /api/health",
    )
    console.rule(style="green")
    console.print()


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
    console.print("[dim]Mixi API – shutdown completo.[/dim]")


# ── Helpers ───────────────────────────────────────────────────


def resolve_audio_url(page_url: str) -> tuple[str, str | None, str | None]:
    """
    Use yt-dlp to extract the direct audio stream URL.
    
    NOTE: This is a blocking function — must be called via
    asyncio.to_thread() to avoid blocking the event loop.

    Returns (direct_url, title, content_type).
    Raises HTTPException on failure.
    """
    logger.info("[ytdlp]Estrazione stream audio in corso…[/ytdlp]")
    t0 = time.perf_counter()

    try:
        with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
            info = ydl.extract_info(page_url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        logger.error("[error]yt-dlp errore di download:[/error] %s", exc)
        raise HTTPException(
            status_code=422,
            detail=f"yt-dlp could not process this URL: {exc}",
        )
    except Exception as exc:
        logger.error("[error]Errore inatteso durante l'estrazione:[/error]", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected extraction error: {exc}",
        )

    elapsed = time.perf_counter() - t0

    if info is None:
        logger.error("[error]Nessuna info restituita da yt-dlp[/error]")
        raise HTTPException(status_code=422, detail="No media info returned.")

    # ── Resolve the direct URL ────────────────────────────────
    direct_url: str | None = info.get("url")

    if not direct_url:
        formats = info.get("formats") or []
        audio_formats = [f for f in formats if f.get("vcodec") == "none"]
        if not audio_formats:
            audio_formats = formats
        if audio_formats:
            audio_formats.sort(key=lambda f: f.get("abr") or 0, reverse=True)
            direct_url = audio_formats[0].get("url")

    if not direct_url:
        logger.error("[error]Impossibile risolvere un URL audio diretto[/error]")
        raise HTTPException(
            status_code=422,
            detail="Could not resolve a direct audio URL from this link.",
        )

    title = info.get("title")
    ext = info.get("ext", "mp3")
    content_type = {
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
        "opus": "audio/opus",
        "wav": "audio/wav",
        "webm": "audio/webm",
    }.get(ext, "application/octet-stream")

    logger.info(
        "[success]Risolto in %.1fs[/success] → [bold]%s[/bold]  [dim](%s, %s)[/dim]",
        elapsed,
        title or "Untitled",
        ext,
        content_type,
    )

    return direct_url, title, content_type


def download_audio(page_url: str) -> tuple[Path, str | None]:
    """
    Download audio via yt-dlp + ffmpeg to a temp MP3 file.
    Handles HLS, DASH, and direct streams transparently.
    Returns (temp_file_path, title).
    """
    logger.info("[ytdlp]Download audio in corso…[/ytdlp]")
    t0 = time.perf_counter()

    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.close()
    
    # Secure templating: insert .%(ext)s right before .mp3
    outtmpl = tmp.name[:-4] + ".%(ext)s"

    opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "outtmpl": outtmpl,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
    }

    title: str | None = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(page_url, download=True)
            title = info.get("title") if info else None
    except yt_dlp.utils.DownloadError as exc:
        Path(tmp_path).unlink(missing_ok=True)
        logger.error("[error]yt-dlp download error:[/error] %s", exc)
        raise HTTPException(status_code=422, detail=f"yt-dlp error: {exc}")
    except Exception as exc:
        Path(tmp_path).unlink(missing_ok=True)
        logger.error("[error]Unexpected download error:[/error]", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Download error: {exc}")

    out = Path(tmp_path)
    if not out.exists() or out.stat().st_size == 0:
        out.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="Download produced no audio file.")

    elapsed = time.perf_counter() - t0
    size_mb = out.stat().st_size / (1024 * 1024)
    logger.info(
        "[success]Download completato in %.1fs[/success] → [bold]%s[/bold] [dim](%.1f MB)[/dim]",
        elapsed, title or "Untitled", size_mb,
    )
    return out, title


async def stream_file(path: Path) -> AsyncGenerator[bytes, None]:
    """Stream a file in 64 KB chunks, then delete it."""
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65_536)
                if not chunk:
                    break
                yield chunk
    finally:
        path.unlink(missing_ok=True)


# ── Endpoints ─────────────────────────────────────────────────


@app.get("/api/stream")
async def stream_endpoint(
    url: str = Query(..., description="SoundCloud or YouTube URL"),
):
    """
    Resolve audio URL via yt-dlp and proxy the stream in 
    real-time from the original CDN to the browser.
    """
    logger.info("[request]Ricevuta richiesta per URL:[/request] [bold]%s[/bold]", url)

    try:
        # 1. Resolve direct CDN URL without downloading
        direct_url, title, content_type = await asyncio.to_thread(resolve_audio_url, url)
    except Exception as e:
        logger.error(f"[error]Resolve error:[/error] {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # 2. Proxy the stream chunk by chunk
    client = await get_http_client()
    
    async def proxy_stream():
        try:
            async with client.stream("GET", direct_url) as response:
                if response.status_code != 200:
                    logger.error(f"[error]Rifiutato dal CDN originario ({response.status_code})[/error]")
                    return
                # Stream the bytes transparently
                async for chunk in response.aiter_bytes(chunk_size=65_536):
                    yield chunk
        except Exception as e:
            logger.error("[error]Interruzione inaspettata dello stream:[/error] %s", e)

    headers: dict[str, str] = {}
    if title:
        # Encode title to ASCII explicitly or rely on strict strings, we'll cast safety
        import urllib.parse
        headers["X-Track-Title"] = urllib.parse.quote(title)

    return StreamingResponse(
        content=proxy_stream(),
        media_type=content_type or "audio/mpeg",
        headers=headers,
    )


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "mixi-stream-proxy"}

# ── Static Files (Production Build) ──────────────────────────
from fastapi.staticfiles import StaticFiles

dist_path = Path(__file__).parent.parent / "dist"
if dist_path.exists() and dist_path.is_dir():
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="spa")


# ── CLI entry point (for Electron / PyInstaller) ─────────────
if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Mixi Engine")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
