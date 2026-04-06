import { describe, it, expect } from 'vitest';
import {
  compareSemver,
  parseTagVersion,
  shouldShowUpdate,
  truncateReleaseNotes,
} from '../../electron/updateCheck';

// ─────────────────────────────────────────────────────────────
// compareSemver
// ─────────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('returns -1 when a < b (major)', () => {
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
  });

  it('compares patch versions', () => {
    expect(compareSemver('0.2.12', '0.2.11')).toBe(1);
    expect(compareSemver('0.2.11', '0.2.12')).toBe(-1);
  });

  it('handles missing patch (treated as 0)', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.1', '1.0')).toBe(1);
  });

  it('handles single-digit versions', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('2', '1.9.9')).toBe(1);
  });

  it('handles real mixi versions', () => {
    expect(compareSemver('0.2.11', '0.2.11')).toBe(0);
    expect(compareSemver('0.3.0', '0.2.11')).toBe(1);
    expect(compareSemver('0.2.11', '0.3.0')).toBe(-1);
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// parseTagVersion
// ─────────────────────────────────────────────────────────────

describe('parseTagVersion', () => {
  it('strips leading v', () => {
    expect(parseTagVersion('v0.2.11')).toBe('0.2.11');
  });

  it('keeps version without v prefix', () => {
    expect(parseTagVersion('0.2.11')).toBe('0.2.11');
  });

  it('only strips first v', () => {
    expect(parseTagVersion('vv1.0.0')).toBe('v1.0.0');
  });

  it('handles just v prefix', () => {
    expect(parseTagVersion('v1')).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────
// shouldShowUpdate
// ─────────────────────────────────────────────────────────────

describe('shouldShowUpdate', () => {
  it('returns true when latest > current', () => {
    expect(shouldShowUpdate('0.2.11', '0.3.0', null)).toBe(true);
  });

  it('returns false when latest == current', () => {
    expect(shouldShowUpdate('0.2.11', '0.2.11', null)).toBe(false);
  });

  it('returns false when latest < current (downgrade)', () => {
    expect(shouldShowUpdate('0.3.0', '0.2.11', null)).toBe(false);
  });

  it('returns false when version is skipped', () => {
    expect(shouldShowUpdate('0.2.11', '0.3.0', '0.3.0')).toBe(false);
  });

  it('returns true when a different version is skipped', () => {
    expect(shouldShowUpdate('0.2.11', '0.4.0', '0.3.0')).toBe(true);
  });

  it('returns true with null skipped version', () => {
    expect(shouldShowUpdate('0.2.11', '1.0.0', null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// truncateReleaseNotes
// ─────────────────────────────────────────────────────────────

describe('truncateReleaseNotes', () => {
  it('returns undefined for null body', () => {
    expect(truncateReleaseNotes(null)).toBeUndefined();
  });

  it('returns undefined for undefined body', () => {
    expect(truncateReleaseNotes(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(truncateReleaseNotes('')).toBeUndefined();
  });

  it('returns full text when under limit', () => {
    const body = 'Bug fixes and improvements';
    expect(truncateReleaseNotes(body)).toBe(body);
  });

  it('truncates with ellipsis at default 500 chars', () => {
    const body = 'x'.repeat(600);
    const result = truncateReleaseNotes(body)!;
    expect(result.length).toBe(503); // 500 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('respects custom max length', () => {
    const body = 'abcdefghij'; // 10 chars
    const result = truncateReleaseNotes(body, 5)!;
    expect(result).toBe('abcde...');
  });

  it('does not truncate when exactly at limit', () => {
    const body = 'x'.repeat(500);
    expect(truncateReleaseNotes(body)).toBe(body);
  });
});
