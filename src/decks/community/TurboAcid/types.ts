// TurboAcid Memory Map Constants (Float32 Indices)
// Total Buffer Size: 1024 bytes = 256 Float32 slots.

export const ACID_MEM_PLAY_STATE = 0;       // 0.0 = Paused, 1.0 = Playing
export const ACID_MEM_BPM = 1;              // Global BPM
export const ACID_MEM_CROSSFADER = 2;       // 0.0 (Deck A) to 1.0 (Deck B)

// --- DECK A CONSTANTS (Offset index: 4) ---
export const DECK_A_OFFSET = 4;
export const DECK_A_CUTOFF = DECK_A_OFFSET + 0;
export const DECK_A_RESONANCE = DECK_A_OFFSET + 1;
export const DECK_A_ENV_MOD = DECK_A_OFFSET + 2;
export const DECK_A_DRIVE = DECK_A_OFFSET + 3;

// Sequencer Memory: 16 Steps for Deck A
// Bitmask stored as Float32 (safe up to 24 bits of precision for ints)
// [Note: 7 bit | Gate: 1 bit | Slide: 1 bit | Accent: 1 bit]
export const DECK_A_SEQ_OFFSET = 16; 

// --- DECK B CONSTANTS (Offset index: 64) ---
export const DECK_B_OFFSET = 64;
export const DECK_B_CUTOFF = DECK_B_OFFSET + 0;
export const DECK_B_RESONANCE = DECK_B_OFFSET + 1;
export const DECK_B_ENV_MOD = DECK_B_OFFSET + 2;
export const DECK_B_DRIVE = DECK_B_OFFSET + 3;

export const DECK_B_SEQ_OFFSET = 76; // 64 + 12 (to keep same relative distance if needed, or 64+16=80)

export type DeckId = 'A' | 'B';

export interface AcidStep {
    note: number;    // 0-127
    gate: boolean;
    slide: boolean;
    accent: boolean;
}
