/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Track load: fetching a track's audio, and saying why it failed
//
// Both browsers (desktop and mobile) load a deck the same way: resolve a
// playable URL, fetch it, hand the bytes to the engine. They also both used to
// report every failure as the same sentence, "Failed to load X to Deck A",
// with the desktop one logging the cause and the mobile one discarding it
// (`catch {}`).
//
// That sentence is what a user can copy into a bug report, and it says nothing.
// The engine is careful to distinguish its failures ("File too large",
// "Failed to parse track format: ...", "Failed to decode initial chunk: ..."),
// and all of that was thrown away one frame above it (#9).
// ─────────────────────────────────────────────────────────────

/** Longest reason shown in a toast before it is shortened. */
const MAX_REASON = 140;

/**
 * Fetches a track's audio, failing with a reason that distinguishes the cases.
 *
 * A dead `blob:` URL rejects with `TypeError: Failed to fetch`, which is
 * indistinguishable from a decode failure once it reaches a generic catch. The
 * distinction matters: one means the audio is gone, the other means the file is
 * not readable, and they have different answers.
 *
 * @param url A blob: or http(s): URL for the track's audio.
 * @returns The raw bytes, guaranteed non-empty.
 * @throws Error with a reason describing which step failed.
 */
export async function fetchTrackAudio(url: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    // A blob: URL is valid only for the document that created it. It does not
    // survive a reload, and it is void once revoked.
    throw new Error(
      `its audio is no longer available in this session (${describeError(err)})`,
    );
  }

  if (!res.ok) {
    throw new Error(`fetching its audio returned HTTP ${res.status}`);
  }

  // fetch('') resolves against the document and hands back the application's
  // own HTML with a 200, which then fails to decode with a misleading message
  // about the audio format. resolvePlayableUrl guards against the empty URL;
  // this catches whatever else lands here.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/html')) {
    throw new Error('its URL resolved to the application page, not to audio');
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error('its audio file is empty (0 bytes)');
  }
  return bytes;
}

/**
 * Turns anything thrown into a short sentence fit for a toast.
 *
 * @param err Whatever reached the catch.
 * @returns A single line, shortened if very long, never empty.
 */
export function describeError(err: unknown): string {
  let text: string;
  if (err instanceof Error && err.message.trim()) {
    text = err.message.trim();
  } else if (typeof err === 'string' && err.trim()) {
    text = err.trim();
  } else {
    text = String(err);
  }
  // Collapse newlines: a toast is one line, and a stack fragment in the middle
  // of a sentence is worse than no detail at all.
  text = text.replace(/\s+/g, ' ');
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 3)}...` : text;
}

/**
 * The message shown when loading a deck fails.
 *
 * @param title The track's title, as the library shows it.
 * @param deck The deck that was being loaded.
 * @param err Whatever reached the catch.
 * @returns The toast text, naming the track, the deck and the reason.
 */
export function deckLoadFailureMessage(title: string, deck: string, err: unknown): string {
  return `Deck ${deck}: could not load "${title}". Reason: ${describeError(err)}`;
}
