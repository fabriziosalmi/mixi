import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deckRegistry } from '../../src/decks/registry';
import { HOUSE_DECKS } from '../../src/decks/index';

describe('DeckRegistry', () => {
  it('returns built-in decks by default', () => {
    const all = deckRegistry.getAll();
    expect(all.length).toBeGreaterThanOrEqual(HOUSE_DECKS.length);
    // Built-in modes should be present
    expect(all.some(d => d.mode === 'groovebox')).toBe(true);
    expect(all.some(d => d.mode === 'turbokick')).toBe(true);
    expect(all.some(d => d.mode === 'js303')).toBe(true);
  });

  it('findByMode returns correct built-in deck', () => {
    const tk = deckRegistry.findByMode('turbokick');
    expect(tk).toBeDefined();
    expect(tk!.label).toBe('TURBOKICK');
    expect(tk!.accentColor).toBe('#ef4444');
  });

  it('findByMode returns undefined for unknown mode', () => {
    const unknown = deckRegistry.findByMode('nonexistent-deck-xyz');
    expect(unknown).toBeUndefined();
  });

  it('findByMode returns correct mode for groovebox', () => {
    const gb = deckRegistry.findByMode('groovebox');
    expect(gb).toBeDefined();
    expect(gb!.mode).toBe('groovebox');
  });

  it('findByMode returns correct mode for js303', () => {
    const js = deckRegistry.findByMode('js303');
    expect(js).toBeDefined();
    expect(js!.label).toBe('TURBOBASS');
  });

  it('all built-in decks have required fields', () => {
    for (const deck of deckRegistry.getAll()) {
      expect(deck.mode).toBeTruthy();
      expect(deck.label).toBeTruthy();
      expect(deck.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(deck.component).toBeDefined();
    }
  });

  it('getAll returns at least 3 built-in decks', () => {
    expect(deckRegistry.getAll().length).toBeGreaterThanOrEqual(3);
  });

  it('subscribe returns unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = deckRegistry.subscribe(cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('handles failed registry fetch gracefully', async () => {
    // Mock fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    // Create a fresh registry-like test
    // The singleton may already be fetched, but calling with a bad URL should not crash
    try {
      await deckRegistry.fetchFromRemote('https://invalid.example.com/404');
    } catch {
      // Should not throw
    }

    // Built-in decks should still be available
    expect(deckRegistry.getAll().length).toBeGreaterThanOrEqual(3);

    globalThis.fetch = originalFetch;
  });
});
