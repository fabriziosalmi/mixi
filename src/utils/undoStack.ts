/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Global Undo Stack
//
// Lightweight undo system for destructive actions.
// Max 20 entries. Each entry has a description and an undo function.
//
// Usage:
//   import { undoStack } from './undoStack';
//   undoStack.push('Delete hot cue 3', () => setHotCue(deck, 3, savedTime));
//   undoStack.undo(); // executes the last pushed undo function
// ─────────────────────────────────────────────────────────────

const MAX_SIZE = 20;

interface UndoEntry {
  description: string;
  undo: () => void;
}

const stack: UndoEntry[] = [];

export const undoStack = {
  /** Push an undoable action onto the stack. */
  push(description: string, undo: () => void): void {
    stack.push({ description, undo });
    if (stack.length > MAX_SIZE) stack.shift();
  },

  /** Undo the last action. Returns the description, or null if empty. */
  undo(): string | null {
    const entry = stack.pop();
    if (!entry) return null;
    entry.undo();
    return entry.description;
  },

  /** Check if there's anything to undo. */
  get canUndo(): boolean {
    return stack.length > 0;
  },

  /** Get the description of what would be undone. */
  get lastDescription(): string | null {
    return stack.length > 0 ? stack[stack.length - 1].description : null;
  },

  /** Clear the stack. */
  clear(): void {
    stack.length = 0;
  },
};
