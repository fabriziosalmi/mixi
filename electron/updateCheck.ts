/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Update Check Logic (pure functions)
//
// Extracted from main.ts for testability.
// ─────────────────────────────────────────────────────────────

/**
 * Compare two semver strings (major.minor.patch).
 * Returns 1 if a > b, 0 if equal, -1 if a < b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Parse a GitHub release tag_name into a clean version string.
 * Strips leading 'v' if present.
 */
export function parseTagVersion(tagName: string): string {
  return tagName.replace(/^v/, '');
}

/**
 * Determine if an update is available and should be shown to the user.
 *
 * @param currentVersion  The running app version (e.g. "0.2.11")
 * @param latestVersion   The latest release version from GitHub (e.g. "0.3.0")
 * @param skippedVersion  The version the user chose to skip (or null)
 * @returns               true if the update dialog should be shown
 */
export function shouldShowUpdate(
  currentVersion: string,
  latestVersion: string,
  skippedVersion: string | null,
): boolean {
  // No update if latest is not newer
  if (compareSemver(latestVersion, currentVersion) <= 0) return false;
  // User chose to skip this version
  if (skippedVersion === latestVersion) return false;
  return true;
}

/**
 * Truncate release notes for display in a dialog.
 * Returns undefined if body is empty/null.
 */
export function truncateReleaseNotes(body: string | null | undefined, maxLength = 500): string | undefined {
  if (!body) return undefined;
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength) + '...';
}
