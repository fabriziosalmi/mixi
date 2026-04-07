/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// 32 Factory Acid Patterns — 4 Banks × 8
//
// Bank A: Classic Acid House (Phuture, Hardfloor, Pierre)
// Bank B: Techno / Industrial (Emmanuel Top, Surgeon, Regis)
// Bank C: Minimal / Deep (Plastikman, Basic Channel, Robert Hood)
// Bank D: Experimental / Performance (polyrhythmic, sparse, weird)
// ─────────────────────────────────────────────────────────────

import { type JS303Step, type JS303Pattern, MAX_STEPS } from './types';

/** Build a step from compact notation: [note, gate, accent, slide, down, up] */
function s(note: number, gate = true, accent = false, slide = false, down = false, up = false): JS303Step {
  return { note, gate, accent, slide, tie: false, down, up };
}

/** Tied step: gate stays open from previous, no envelope re-trigger */
function t(note: number, slide = false): JS303Step {
  return { note, gate: true, accent: false, slide, tie: true, down: false, up: false };
}

/** Rest (gate off) */
function r(note = 36): JS303Step {
  return { note, gate: false, accent: false, slide: false, tie: false, down: false, up: false };
}

/** Pad pattern to 32 steps (second half rests by default) */
function pad(steps: JS303Step[]): JS303Step[] {
  while (steps.length < MAX_STEPS) steps.push(r());
  return steps.slice(0, MAX_STEPS);
}

// ══════════════════════════════════════════════════════════════
// BANK A — Classic Acid House
// ══════════════════════════════════════════════════════════════

const A01: JS303Pattern = {
  name: 'Acid Trax',
  steps: pad([
    s(36), r(), s(36, true, true), t(36),
    s(39), s(43, true, false, true), s(36), r(),
    s(36), s(48, true, true), r(), s(36),
    s(39, true, false, true), t(39, true), s(36, true, true), r(),
  ]),
};

const A02: JS303Pattern = {
  name: 'Hardfloor',
  steps: pad([
    s(36, true, true), s(48, true, false, true), s(36), s(39),
    s(43, true, true), s(36, true, false, true), s(48), s(36),
    s(39, true, true), s(48, true, false, true), s(36), s(43),
    s(36, true, true), s(48, true, false, true), s(39), s(36),
  ]),
};

const A03: JS303Pattern = {
  name: 'Wild Pitch',
  steps: pad([
    s(36), r(), s(43), s(36, true, true),
    r(), s(48, true, false, true), s(43), r(),
    s(36), s(39, true, true), r(), s(36),
    s(43, true, false, true), r(), s(48, true, true), r(),
  ]),
};

const A04: JS303Pattern = {
  name: 'Pierre',
  steps: pad([
    s(36, true, true), s(36), s(48, true, false, true), s(36),
    r(), s(36, true, true), r(), s(39),
    s(36), s(48, true, true, true), s(43), s(36),
    r(), s(36, true, true), s(39, true, false, true), r(),
  ]),
};

const A05: JS303Pattern = {
  name: 'Pump It Up',
  steps: pad([
    s(36), s(36), r(), s(36, true, true),
    s(39, true, false, true), s(36), r(), s(43),
    s(36), s(36, true, true), r(), s(48, true, false, true),
    s(36), r(), s(39), s(36),
  ]),
};

const A06: JS303Pattern = {
  name: 'Sleazy',
  steps: pad([
    s(36, true, true), r(), s(39), r(),
    s(43, true, false, true), s(48), r(), s(36),
    r(), s(43, true, true), r(), s(36, true, false, true),
    s(39), r(), s(36, true, true), r(),
  ]),
};

const A07: JS303Pattern = {
  name: 'Da Funk',
  steps: pad([
    s(41), r(), s(41), r(),
    s(43, true, true), r(), s(41, true, false, true), s(36),
    s(41), r(), s(41), r(),
    s(43, true, true), s(48, true, false, true), s(41), r(),
  ]),
};

const A08: JS303Pattern = {
  name: 'Mentasm',
  steps: pad([
    s(36, true, true), s(43, true, false, true), s(36), s(48, true, true),
    s(36, true, false, true), s(43), s(36, true, true), s(48, true, false, true),
    s(36), s(43, true, true), s(36, true, false, true), s(48),
    s(36, true, true), s(43, true, false, true), s(36), s(48, true, true),
  ]),
};

// ══════════════════════════════════════════════════════════════
// BANK B — Techno / Industrial
// ══════════════════════════════════════════════════════════════

const B01: JS303Pattern = {
  name: 'Surgeon',
  steps: pad([
    s(36, true, true), r(), r(), s(36),
    r(), s(36, true, true), r(), r(),
    s(39, true, false, true), r(), s(36), r(),
    r(), s(36, true, true), r(), r(),
  ]),
};

const B02: JS303Pattern = {
  name: 'Berghain',
  steps: pad([
    s(36), r(), s(36, true, true), r(),
    r(), r(), s(39, true, false, true), r(),
    s(36), r(), r(), s(36, true, true),
    r(), r(), s(36, true, false, true), r(),
  ]),
};

const B03: JS303Pattern = {
  name: 'Regis',
  steps: pad([
    s(36, true, true), s(36), r(), s(39),
    r(), s(36, true, true), s(43, true, false, true), r(),
    s(36), r(), s(36, true, true), s(39, true, false, true),
    r(), s(36), r(), s(43, true, true),
  ]),
};

const B04: JS303Pattern = {
  name: 'Monolith',
  steps: pad([
    s(36), s(36), s(36), s(36),
    s(39, true, true), s(36, true, false, true), s(36), s(36),
    s(36), s(36), s(39, true, true), s(36),
    s(36), s(43, true, true, true), s(36), s(36),
  ]),
};

const B05: JS303Pattern = {
  name: 'EBM Grind',
  steps: pad([
    s(36, true, true), s(48, true, false, true), r(), s(36),
    s(48, true, true), r(), s(36, true, false, true), s(48),
    r(), s(36, true, true), s(48, true, false, true), r(),
    s(36), s(48, true, true), r(), s(36, true, false, true),
  ]),
};

const B06: JS303Pattern = {
  name: 'Warehouse',
  steps: pad([
    s(36), r(), s(43, true, true), r(),
    s(36), r(), r(), s(39, true, false, true),
    s(36, true, true), r(), s(43), r(),
    r(), s(36), r(), s(39, true, true),
  ]),
};

const B07: JS303Pattern = {
  name: 'Ostgut',
  steps: pad([
    s(36, true, true), r(), s(36), s(39, true, false, true),
    r(), s(36), r(), s(36, true, true),
    s(43, true, false, true), r(), s(36), r(),
    s(39, true, true), s(36, true, false, true), r(), s(36),
  ]),
};

const B08: JS303Pattern = {
  name: 'Schranz',
  steps: pad([
    s(36, true, true), s(36), s(36, true, true), s(36),
    s(39, true, true), s(36), s(36, true, true), s(36),
    s(36, true, true), s(43, true, false, true), s(36, true, true), s(36),
    s(39, true, true), s(36), s(48, true, true, true), s(36),
  ]),
};

// ══════════════════════════════════════════════════════════════
// BANK C — Minimal / Deep
// ══════════════════════════════════════════════════════════════

const C01: JS303Pattern = {
  name: 'Plastikman',
  steps: pad([
    s(36), r(), r(), r(),
    r(), s(39, true, false, true), r(), r(),
    s(36, true, true), r(), r(), r(),
    r(), r(), s(43, true, false, true), r(),
  ]),
};

const C02: JS303Pattern = {
  name: 'Hypnotic',
  steps: pad([
    s(36), r(), s(36), r(),
    s(36), r(), s(36), r(),
    s(39, true, true), r(), s(36, true, false, true), r(),
    s(36), r(), s(36), r(),
  ]),
};

const C03: JS303Pattern = {
  name: 'Deep Space',
  steps: pad([
    s(36, true, false, false, true), r(), r(), s(43, true, false, true),
    r(), r(), r(), r(),
    s(36), r(), r(), s(39, true, false, true),
    r(), r(), r(), r(),
  ]),
};

const C04: JS303Pattern = {
  name: 'Microglide',
  steps: pad([
    s(36), s(37, true, false, true), s(36), r(),
    s(38, true, false, true), s(36), r(), r(),
    s(36), s(39, true, false, true), s(36), r(),
    s(38, true, false, true), s(36), r(), r(),
  ]),
};

const C05: JS303Pattern = {
  name: 'R. Hood',
  steps: pad([
    s(36, true, true), r(), r(), s(36),
    r(), r(), s(36, true, true), r(),
    r(), s(36), r(), r(),
    s(36, true, true), r(), r(), r(),
  ]),
};

const C06: JS303Pattern = {
  name: 'Dub Chord',
  steps: pad([
    s(36), r(), r(), r(),
    r(), r(), s(43, true, true), r(),
    r(), r(), r(), s(36, true, false, true),
    r(), r(), r(), r(),
  ]),
};

const C07: JS303Pattern = {
  name: 'Looping',
  steps: pad([
    s(36), s(38, true, false, true), s(40, true, false, true), s(43),
    s(40, true, false, true), s(38, true, false, true), s(36), r(),
    s(36), s(38, true, false, true), s(40, true, false, true), s(43, true, true),
    s(40, true, false, true), s(38, true, false, true), s(36), r(),
  ]),
};

const C08: JS303Pattern = {
  name: 'Pulse',
  steps: pad([
    s(36), r(), r(), r(),
    s(36), r(), r(), r(),
    s(36, true, true), r(), r(), r(),
    s(36), r(), r(), s(48, true, true, true),
  ]),
};

// ══════════════════════════════════════════════════════════════
// BANK D — Experimental / Performance
// ══════════════════════════════════════════════════════════════

const D01: JS303Pattern = {
  name: 'Poly 7',
  steps: pad([
    s(36, true, true), r(), s(39), s(43, true, false, true),
    r(), s(36), s(48, true, true), r(),
    s(36), r(), s(39, true, false, true), s(43),
    r(), s(36, true, true), s(48, true, false, true), r(),
  ]),
};

const D02: JS303Pattern = {
  name: 'Stutter',
  steps: pad([
    s(36), s(36), s(36), r(),
    s(39), s(39), r(), r(),
    s(36), s(36), s(36), r(),
    s(43, true, true), s(43), r(), r(),
  ]),
};

const D03: JS303Pattern = {
  name: 'Chromatic',
  steps: pad([
    s(36, true, true), s(37, true, false, true), s(38, true, false, true), s(39, true, false, true),
    s(40, true, false, true), s(41, true, false, true), s(42, true, false, true), s(43, true, false, true),
    s(44, true, true, true), s(45, true, false, true), s(46, true, false, true), s(47, true, false, true),
    s(48, true, true), s(47, true, false, true), s(43, true, false, true), s(36, true, false, true),
  ]),
};

const D04: JS303Pattern = {
  name: 'Random Feel',
  steps: pad([
    s(36), r(), s(43, true, true), s(41, true, false, true),
    r(), s(38), r(), s(46, true, true, false, false, true),
    s(36, true, false, true), r(), s(41), r(),
    s(43, true, true), r(), s(38, true, false, true), r(),
  ]),
};

const D05: JS303Pattern = {
  name: 'Octave Jump',
  steps: pad([
    s(36, true, true), r(), s(48, true, false, true, false, true), r(),
    s(36), r(), s(48, true, true, true, false, true), r(),
    s(36, true, true), r(), s(48, true, false, true, false, true), r(),
    s(24, true, true, false, true), r(), s(48, true, false, true, false, true), r(),
  ]),
};

const D06: JS303Pattern = {
  name: 'Trance Gate',
  steps: pad([
    s(36), s(36), r(), s(36),
    s(36), r(), s(36), r(),
    s(36, true, true), s(36), r(), s(36),
    s(36), r(), s(39, true, true, true), r(),
  ]),
};

const D07: JS303Pattern = {
  name: 'Acid Rain',
  steps: pad([
    s(48, true, true, false, false, true), s(43, true, false, true), s(39, true, false, true), s(36),
    r(), r(), s(36, true, true), s(39, true, false, true),
    s(43, true, false, true), s(48, true, true, false, false, true), r(), s(36),
    r(), s(43, true, false, true), s(36, true, true), r(),
  ]),
};

const D08: JS303Pattern = {
  name: 'Machine',
  steps: pad([
    s(36, true, true), s(36), s(36), s(36, true, true),
    s(36), s(36), s(36, true, true), s(36),
    s(36), s(36, true, true), s(36), s(36),
    s(36, true, true), s(36), s(36), s(36, true, true),
  ]),
};

// ══════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════

export const FACTORY_BANKS: JS303Pattern[][] = [
  [A01, A02, A03, A04, A05, A06, A07, A08], // Bank A — Classic Acid
  [B01, B02, B03, B04, B05, B06, B07, B08], // Bank B — Techno
  [C01, C02, C03, C04, C05, C06, C07, C08], // Bank C — Minimal
  [D01, D02, D03, D04, D05, D06, D07, D08], // Bank D — Experimental
];

export const BANK_NAMES = ['A', 'B', 'C', 'D'];
