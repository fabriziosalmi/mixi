/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// Loading a deck, and what the user is told when it does not work.
//
// #9 reported "Failed to load [song] to Deck A" for every mp3, on the Windows
// build and in two browsers. That sentence was the whole of what a user could
// see, and it was the same sentence whatever had gone wrong: a dead blob URL, a
// file too large, a format the engine could not parse, a decode failure. The
// desktop browser logged the cause to the console and the mobile one discarded
// it with `catch {}`.
//
// These tests pin the distinctions, because a report that names the step is the
// difference between a fix and three months of silence.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchTrackAudio,
  describeError,
  deckLoadFailureMessage,
} from '../../src/audio/trackLoad';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function respondWith(body: ArrayBuffer, init: { status?: number; type?: string } = {}) {
  const headers = new Headers();
  if (init.type) headers.set('content-type', init.type);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers,
    arrayBuffer: async () => body,
  } as unknown as Response);
}

describe('fetchTrackAudio', () => {
  it('returns the bytes when the fetch succeeds', async () => {
    respondWith(new ArrayBuffer(1024), { type: 'audio/mpeg' });
    const bytes = await fetchTrackAudio('blob:mixi/abc');
    expect(bytes.byteLength).toBe(1024);
  });

  it('says the audio is gone when the blob URL is dead', async () => {
    // What a revoked or previous-session blob: URL actually does. The raw
    // TypeError says "Failed to fetch", which names neither the track nor
    // the reason.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchTrackAudio('blob:mixi/dead')).rejects.toThrow(
      /no longer available in this session/,
    );
  });

  it('reports the status when the request is refused', async () => {
    respondWith(new ArrayBuffer(0), { status: 404 });
    await expect(fetchTrackAudio('https://example.com/x.mp3')).rejects.toThrow(/HTTP 404/);
  });

  it('catches a URL that resolves to the application page', async () => {
    // fetch('') resolves against the document and returns the app's own HTML
    // with a 200. Handing that to the decoder produces a complaint about the
    // audio format, which sends the reader looking in the wrong place.
    respondWith(new ArrayBuffer(4096), { type: 'text/html; charset=utf-8' });
    await expect(fetchTrackAudio('')).rejects.toThrow(/application page/);
  });

  it('catches an empty file before the decoder does', async () => {
    respondWith(new ArrayBuffer(0), { type: 'audio/mpeg' });
    await expect(fetchTrackAudio('blob:mixi/empty')).rejects.toThrow(/empty \(0 bytes\)/);
  });
});

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('accepts a thrown string', () => {
    expect(describeError('boom')).toBe('boom');
  });

  it('never returns an empty string', () => {
    expect(describeError(new Error(''))).not.toBe('');
    expect(describeError(undefined)).not.toBe('');
    expect(describeError(null)).not.toBe('');
  });

  it('collapses newlines, so a stack fragment cannot break the line', () => {
    expect(describeError(new Error('first\n  at second\n  at third')))
      .toBe('first at second at third');
  });

  it('shortens a very long message rather than filling the screen', () => {
    const long = describeError(new Error('x'.repeat(500)));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('deckLoadFailureMessage', () => {
  it('names the track, the deck and the reason', () => {
    const msg = deckLoadFailureMessage('Blue Monday', 'A', new Error('boom'));
    expect(msg).toContain('Blue Monday');
    expect(msg).toContain('Deck A');
    expect(msg).toContain('boom');
  });

  // The regression this file exists for. Each of these is a distinct failure
  // the engine already takes care to describe, and every one of them used to
  // arrive at the user as the same sentence.
  it.each([
    ['File too large (2400MB). Maximum is 2000MB.'],
    ['Failed to parse track format: RangeError: offset is out of bounds'],
    ['Failed to decode initial chunk: EncodingError: Unable to decode audio data'],
    ['its audio is no longer available in this session (Failed to fetch)'],
  ])('carries the engine reason through: %s', (reason) => {
    expect(deckLoadFailureMessage('Track', 'B', new Error(reason))).toContain(reason);
  });
});
