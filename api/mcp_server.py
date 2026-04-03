# Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
#
# This file is part of MIXI.
# MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
# You may not use this file for commercial purposes without explicit permission.
# For commercial licensing, contact: fabrizio.salmi@gmail.com

# ─────────────────────────────────────────────────────────────
# Mixi – MCP Server (Model Context Protocol)
#
# Exposes the Mixi mixer as a set of AI-callable tools via
# the Model Context Protocol.  Claude (or any MCP-compatible
# AI) can connect to this server and control every knob,
# fader, and button on the mixer in real-time.
#
# Architecture:
#   Claude ←→ MCP Protocol ←→ This server ←→ HTTP ←→ FastAPI ←→ WS ←→ Browser
#
# The MCP server translates tool calls into REST POST requests
# to the FastAPI /api/command endpoint, which relays them to
# the browser via WebSocket.
#
# Setup:
#   pip install mcp httpx
#
# Run:
#   python api/mcp_server.py
#   (or via: npm run dev:mcp)
# ─────────────────────────────────────────────────────────────

from __future__ import annotations

import httpx
from mcp.server.fastmcp import FastMCP

# ── MCP Server instance ──────────────────────────────────────

mcp = FastMCP(
    name="mixi-dj",
    instructions="""You are controlling Mixi, a professional 2-deck DJ mixer running in a web browser.

## Architecture
Your tool calls go through: MCP → HTTP → WebSocket → Browser → Zustand Store → Audio Engine.
The browser UI updates reactively — knobs and faders move visually when you change values.

## Deck IDs
Always use "A" or "B" (uppercase strings) for deck parameters.

## Value Ranges
- Volumes, crossfader, headphone level: 0.0 to 1.0
- EQ bands (low/mid/high): -40 (kill) to +6 (boost), 0 = flat
- Color FX: -1.0 (lowpass) to +1.0 (highpass), 0 = off
- Playback rate: 0.92 to 1.08 (±8% pitch)

## DJ Workflow
1. Load tracks into both decks (done by the user via the UI)
2. Check BPM of both tracks via get_mixer_state
3. Use sync_deck to match tempos
4. Use EQ to blend: kill the bass on the incoming track, then swap
5. Move the crossfader to transition
6. Use loops to extend sections for longer transitions

## Mixing Tips
- Never cut the bass on both tracks simultaneously (kills energy)
- Transition over 16-32 beats for smooth blends
- Use the color filter for dramatic sweeps
- Hot cues let you jump to specific points (drops, breakdowns)
""",
)

API_BASE = "http://localhost:8000"

# ── Helper ────────────────────────────────────────────────────


async def _send(action: str, args: list) -> str:
    """Send a command to the Mixi backend and return the result."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{API_BASE}/api/command",
            json={"action": action, "args": args},
        )
        if resp.status_code == 503:
            return "Error: No browser connected. The user must open Mixi and click 'Inizia' first."
        resp.raise_for_status()
        data = resp.json()
        if data.get("ok"):
            return f"OK — {action}({', '.join(str(a) for a in args)})"
        return f"Error: {data.get('error', 'unknown')}"


# ── Tools: State ──────────────────────────────────────────────


@mcp.tool()
async def get_mixer_state() -> str:
    """
    Get the current state of the entire mixer.

    Returns a JSON object with:
    - master.volume, crossfader position
    - headphones (level, mix, splitMode)
    - For each deck (A, B): isPlaying, volume, EQ, colorFx, bpm,
      playbackRate, duration, currentTime, hotCues, activeLoop, etc.

    Use this to understand what's happening before making changes.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{API_BASE}/api/state")
        if resp.status_code == 503:
            return "No state available — browser not connected."
        resp.raise_for_status()
        import json
        return json.dumps(resp.json(), indent=2)


# ── Tools: Master & Crossfader ────────────────────────────────


@mcp.tool()
async def set_master_volume(volume: float) -> str:
    """Set the master output volume. Range: 0.0 (silent) to 1.0 (full)."""
    return await _send("setMasterVolume", [volume])


@mcp.tool()
async def set_crossfader(position: float) -> str:
    """
    Set the crossfader position.
    0.0 = full Deck A, 0.5 = center (both decks), 1.0 = full Deck B.
    Uses equal-power (cosine) curve — no volume dip at center.
    """
    return await _send("setCrossfader", [position])


# ── Tools: Deck Transport ─────────────────────────────────────


@mcp.tool()
async def play(deck: str) -> str:
    """Start playback on a deck. deck must be "A" or "B"."""
    return await _send("setDeckPlaying", [deck, True])


@mcp.tool()
async def pause(deck: str) -> str:
    """Pause playback on a deck. deck must be "A" or "B"."""
    return await _send("setDeckPlaying", [deck, False])


# ── Tools: Volume & EQ ────────────────────────────────────────


@mcp.tool()
async def set_deck_volume(deck: str, volume: float) -> str:
    """Set the channel fader (line fader) for a deck. Range: 0.0 to 1.0."""
    return await _send("setDeckVolume", [deck, volume])


@mcp.tool()
async def set_eq(deck: str, band: str, db: float) -> str:
    """
    Set an EQ band on a deck.
    band: "low", "mid", or "high"
    db: -40 (kill) to +6 (boost), 0 = flat.
    Example: set_eq("A", "low", -40) kills the bass on deck A.
    """
    return await _send("setDeckEq", [deck, band, db])


@mcp.tool()
async def set_color_fx(deck: str, value: float) -> str:
    """
    Set the Color FX filter on a deck.
    -1.0 = lowpass fully closed (muffled)
     0.0 = off (transparent)
    +1.0 = highpass fully open (thin/bright)
    """
    return await _send("setDeckColorFx", [deck, value])


# ── Tools: Tempo & Sync ──────────────────────────────────────


@mcp.tool()
async def set_playback_rate(deck: str, rate: float) -> str:
    """
    Set the playback rate (pitch/tempo) for a deck.
    Range: 0.92 to 1.08 (±8% pitch). 1.0 = original speed.
    """
    return await _send("setDeckPlaybackRate", [deck, rate])


@mcp.tool()
async def sync_deck(deck: str) -> str:
    """
    Sync this deck's tempo to the OTHER deck's BPM.
    Automatically adjusts playbackRate to match.
    Both decks must have tracks loaded with detected BPM.
    """
    return await _send("syncDeck", [deck])


@mcp.tool()
async def unsync_deck(deck: str) -> str:
    """Release sync — reset playback rate to 1.0 (original tempo)."""
    return await _send("unsyncDeck", [deck])


# ── Tools: Hot Cues ───────────────────────────────────────────


@mcp.tool()
async def trigger_hot_cue(deck: str, index: int) -> str:
    """
    Jump to a saved hot cue point. index: 0-7.
    The cue must have been previously set by the user.
    """
    return await _send("triggerHotCue", [deck, index])


# ── Tools: Loops ──────────────────────────────────────────────


@mcp.tool()
async def set_auto_loop(deck: str, beats: float) -> str:
    """
    Activate an auto-loop of the given length in beats.
    Common values: 0.25, 0.5, 1, 2, 4, 8, 16, 32.
    The loop snaps to the beatgrid for perfect timing.
    """
    return await _send("setAutoLoop", [deck, beats])


@mcp.tool()
async def exit_loop(deck: str) -> str:
    """Exit the active loop on a deck. Playback continues normally."""
    return await _send("exitLoop", [deck])


# ── Tools: PFL / Headphones ──────────────────────────────────


@mcp.tool()
async def toggle_cue(deck: str) -> str:
    """Toggle the CUE (PFL / Pre-Fader Listen) button for a deck."""
    return await _send("toggleCue", [deck])


@mcp.tool()
async def set_headphone_mix(mix: float) -> str:
    """
    Set the headphone CUE/MASTER mix.
    0.0 = hear only CUE'd tracks, 1.0 = hear only master output.
    """
    return await _send("setHeadphoneMix", [mix])


@mcp.tool()
async def set_headphone_level(level: float) -> str:
    """Set the headphone output level. Range: 0.0 to 1.0."""
    return await _send("setHeadphoneLevel", [level])


# ── Entry point ───────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
