# Mixi API Documentation

Base URL: `http://localhost:8000`

---

## REST Endpoints

### GET /api/health

Health check / liveness probe.

**Response:**
```json
{
  "status": "ok",
  "service": "mixi-stream-proxy"
}
```

---

### GET /api/stream

Download and proxy an audio stream from SoundCloud or YouTube via yt-dlp.
The backend downloads the audio with yt-dlp + FFmpeg, converts to MP3 (192 kbps),
and streams the result in 64 KB chunks. Handles HLS, DASH, and direct streams transparently.

**Query Parameters:**

| Param | Type   | Required | Description                         |
|-------|--------|----------|-------------------------------------|
| url   | string | yes      | SoundCloud or YouTube URL to stream |

**Response:** Binary audio stream (`audio/mpeg`, chunked, 64 KB blocks).

**Response Headers:**

| Header          | Description                                  |
|-----------------|----------------------------------------------|
| Content-Type    | Always `audio/mpeg` (converted to MP3)       |
| X-Track-Title   | Track title extracted by yt-dlp (when available) |

**Errors:**

| Code | Reason                                        |
|------|-----------------------------------------------|
| 422  | yt-dlp could not process the URL or no audio produced |
| 500  | Unexpected extraction / download error        |

---

### GET /api/state

Returns the latest mixer state snapshot cached from the browser WebSocket connection.

**Response:** JSON object with complete mixer state:

```json
{
  "master": { "volume": 0.8 },
  "crossfader": 0.5,
  "headphones": { "level": 0.8, "mix": 0.5, "splitMode": false },
  "decks": {
    "A": {
      "isPlaying": false,
      "isTrackLoaded": true,
      "volume": 0.8,
      "gain": 0,
      "eq": { "low": 0, "mid": 0, "high": 0 },
      "colorFx": 0,
      "playbackRate": 1.0,
      "keyLock": false,
      "duration": 245.3,
      "bpm": 128,
      "originalBpm": 128,
      "firstBeatOffset": 0.12,
      "isSynced": false,
      "hotCues": [null, null, null, null, null, null, null, null],
      "activeLoop": null,
      "quantize": true,
      "cueActive": false,
      "trackName": "Artist - Track Title",
      "musicalKey": "8A",
      "currentTime": 42.7
    },
    "B": { "...": "same structure as A" }
  }
}
```

**Errors:**

| Code | Reason                          |
|------|---------------------------------|
| 503  | No state available (no browser connected) |

---

### POST /api/command

Send a command to the browser mixer via WebSocket bridge.

**Request Body:**

```json
{
  "action": "string",
  "args": []
}
```

**Response:**

```json
{
  "type": "response",
  "id": "uuid",
  "ok": true
}
```

**Errors:**

| Code | Reason                                |
|------|---------------------------------------|
| 400  | Missing or invalid `action` / `args`  |
| 503  | No browser connected                  |
| 504  | Browser did not respond (5 s timeout) |

---

## WebSocket Endpoints

### WS /ws/mixer

Bidirectional bridge between the browser UI and the backend. Single-client.

**Messages from Browser → Server:**

State update (pushed on every mixer state change, throttled to 50 ms):
```json
{
  "type": "state",
  "data": { /* SerializableMixerState — see GET /api/state */ }
}
```

Command response:
```json
{
  "type": "response",
  "id": "uuid",
  "ok": true,
  "error": "string (if ok is false)"
}
```

**Messages from Server → Browser:**

Command request (triggered by POST /api/command or MCP tools):
```json
{
  "type": "command",
  "id": "uuid",
  "action": "string",
  "args": []
}
```

State request:
```json
{
  "type": "get_state",
  "id": "uuid"
}
```

---

## Command Actions

Valid `action` values for POST /api/command and WS commands.
Only whitelisted actions are accepted — all others are rejected with an error.

### Master & Crossfader

| Action             | Args                           | Description              |
|--------------------|--------------------------------|--------------------------|
| `setMasterVolume`  | `[volume: 0.0–1.0]`           | Set master output volume |
| `setCrossfader`    | `[position: 0.0–1.0]`         | 0.0 = Deck A, 0.5 = center, 1.0 = Deck B |

### Deck Transport

| Action            | Args                              | Description        |
|-------------------|-----------------------------------|--------------------|
| `setDeckPlaying`  | `[deck: "A"\|"B", playing: bool]` | Play / pause       |

### Volume, Gain & EQ

| Action            | Args                                              | Description           |
|-------------------|---------------------------------------------------|-----------------------|
| `setDeckVolume`   | `[deck: "A"\|"B", volume: 0.0–1.0]`              | Channel fader         |
| `setDeckGain`     | `[deck: "A"\|"B", db: -12–+12]`                  | Trim / gain knob (dB) |
| `setDeckEq`       | `[deck: "A"\|"B", band: "low"\|"mid"\|"high", db: -40–+6]` | EQ band (dB). -40 = kill, 0 = flat |
| `setDeckColorFx`  | `[deck: "A"\|"B", value: -1.0–+1.0]`             | Color FX filter. -1 = LPF, 0 = off, +1 = HPF |

### Tempo, Sync & Key Lock

| Action                | Args                                   | Description                |
|-----------------------|----------------------------------------|----------------------------|
| `setDeckPlaybackRate` | `[deck: "A"\|"B", rate: 0.84–1.16]`   | Playback rate (1.0 = original). Range depends on ±8/±16% mode |
| `syncDeck`            | `[deck: "A"\|"B"]`                     | Match this deck's tempo to the other deck |
| `unsyncDeck`          | `[deck: "A"\|"B"]`                     | Release sync, reset rate to 1.0 |
| `setKeyLock`          | `[deck: "A"\|"B", enabled: bool]`      | Lock musical key when changing tempo |

### Hot Cues

| Action          | Args                                    | Description                 |
|-----------------|-----------------------------------------|-----------------------------|
| `setHotCue`     | `[deck: "A"\|"B", index: 0–7, time: s]`| Save a hot cue at time (seconds) |
| `triggerHotCue` | `[deck: "A"\|"B", index: 0–7]`         | Jump to a saved hot cue     |
| `deleteHotCue`  | `[deck: "A"\|"B", index: 0–7]`         | Remove a hot cue            |

### Loops

| Action        | Args                                  | Description                 |
|---------------|---------------------------------------|-----------------------------|
| `setAutoLoop` | `[deck: "A"\|"B", beats: float]`     | Set auto-loop (0.25, 0.5, 1, 2, 4, 8, 16, 32) |
| `exitLoop`    | `[deck: "A"\|"B"]`                    | Exit active loop            |

### Headphones

| Action              | Args                       | Description                          |
|---------------------|----------------------------|--------------------------------------|
| `toggleCue`         | `[deck: "A"\|"B"]`         | Toggle PFL / cue monitoring          |
| `setHeadphoneMix`   | `[mix: 0.0–1.0]`          | 0.0 = CUE only, 1.0 = master only   |
| `setHeadphoneLevel`  | `[level: 0.0–1.0]`       | Headphone output volume              |
| `toggleSplitMode`   | `[]`                       | Toggle mono split (L=CUE, R=Master)  |

### Quantize

| Action        | Args                              | Description              |
|---------------|-----------------------------------|--------------------------|
| `setQuantize` | `[deck: "A"\|"B", enabled: bool]` | Snap actions to beatgrid |

---

## MCP Server (Model Context Protocol)

The MCP server (`api/mcp_server.py`) exposes the mixer as AI-callable tools
for Claude or any MCP-compatible agent.

**Architecture:**
```
Claude ←→ MCP Protocol ←→ mcp_server.py ←→ HTTP ←→ main.py ←→ WS ←→ Browser
```

**Run:** `python api/mcp_server.py` (stdio transport)

**Available Tools:**

| Tool                  | Parameters                          | Maps to Action          |
|-----------------------|-------------------------------------|-------------------------|
| `get_mixer_state`     | —                                   | GET /api/state          |
| `set_master_volume`   | `volume: float`                     | `setMasterVolume`       |
| `set_crossfader`      | `position: float`                   | `setCrossfader`         |
| `play`                | `deck: str`                         | `setDeckPlaying` true   |
| `pause`               | `deck: str`                         | `setDeckPlaying` false  |
| `set_deck_volume`     | `deck: str, volume: float`          | `setDeckVolume`         |
| `set_eq`              | `deck: str, band: str, db: float`   | `setDeckEq`             |
| `set_color_fx`        | `deck: str, value: float`           | `setDeckColorFx`        |
| `set_playback_rate`   | `deck: str, rate: float`            | `setDeckPlaybackRate`   |
| `sync_deck`           | `deck: str`                         | `syncDeck`              |
| `unsync_deck`         | `deck: str`                         | `unsyncDeck`            |
| `trigger_hot_cue`     | `deck: str, index: int`             | `triggerHotCue`         |
| `set_auto_loop`       | `deck: str, beats: float`           | `setAutoLoop`           |
| `exit_loop`           | `deck: str`                         | `exitLoop`              |
| `toggle_cue`          | `deck: str`                         | `toggleCue`             |
| `set_headphone_mix`   | `mix: float`                        | `setHeadphoneMix`       |
| `set_headphone_level` | `level: float`                      | `setHeadphoneLevel`     |

---

## CORS

- **Allowed Origins:** `*`
- **Allowed Methods:** GET, POST
- **Exposed Headers:** Content-Length, Content-Type, X-Track-Title

---

## Static File Serving

In production, when a `dist/` folder exists in the project root, the FastAPI
server mounts it as a SPA static file server at `/`, serving the built
frontend alongside the API.
