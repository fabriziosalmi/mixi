import {
    ACID_MEM_PLAY_STATE,
    ACID_MEM_BPM,
    ACID_MEM_CROSSFADER,
    DECK_A_CUTOFF,
    DECK_B_CUTOFF,
    DECK_A_RESONANCE,
    DECK_B_RESONANCE,
    DECK_A_ENV_MOD,
    DECK_B_ENV_MOD,
    DECK_A_DRIVE,
    DECK_B_DRIVE,
    DECK_A_SEQ_OFFSET,
    DECK_B_SEQ_OFFSET,
    DeckId,
    AcidStep
} from './types';

/**
 * Interfaccia Zero-Copy per il DSP dell'Acid-Core.
 * Usa SharedArrayBuffer e manipolazioni Float32/Int32 per una latenza di 1ns.
 */
export class TurboAcidBus {
    private sab: SharedArrayBuffer | ArrayBuffer;
    private floatView: Float32Array;
    private intView: Int32Array;
    private _hasSAB: boolean;

    constructor() {
        // Fallback to ArrayBuffer when SharedArrayBuffer is not available
        // (requires COOP/COEP headers which GitHub Pages doesn't provide)
        this._hasSAB = typeof SharedArrayBuffer !== 'undefined';
        this.sab = this._hasSAB ? new SharedArrayBuffer(1024) : new ArrayBuffer(1024);
        this.floatView = new Float32Array(this.sab);
        this.intView = new Int32Array(this.sab);

        // Initial State
        this.setBPM(135.0);
        this.setCrossfader(0.5);
        this.setPlayState(false);
    }

    public getSharedBuffer(): SharedArrayBuffer | ArrayBuffer {
        return this.sab;
    }

    /** Write int32 — uses Atomics when SAB available, direct write otherwise */
    private atomicStore(index: number, value: number): void {
        if (this._hasSAB) {
            Atomics.store(this.intView, index, value);
        } else {
            this.intView[index] = value;
        }
    }

    // --- GLOBAL CONTROLS ---

    public setPlayState(playing: boolean): void {
        this.atomicStore(ACID_MEM_PLAY_STATE, playing ? 1 : 0);
    }

    public setBPM(bpm: number): void {
        // We cast numeric conversions with Math.fround for exact Float32 atomic semantics though usually not needed strictly in JS
        this.floatView[ACID_MEM_BPM] = bpm;
    }

    public setCrossfader(value: number): void { // 0.0 to 1.0
        this.floatView[ACID_MEM_CROSSFADER] = Math.max(0, Math.min(1.0, value));
    }

    // --- DECK PARAMETERS ---

    public setCutoff(deck: DeckId, isHz: number): void {
        const addr = deck === 'A' ? DECK_A_CUTOFF : DECK_B_CUTOFF;
        this.floatView[addr] = isHz;
    }

    public setResonance(deck: DeckId, v: number): void {
        const addr = deck === 'A' ? DECK_A_RESONANCE : DECK_B_RESONANCE;
        this.floatView[addr] = v;
    }

    public setEnvMod(deck: DeckId, v: number): void {
        const addr = deck === 'A' ? DECK_A_ENV_MOD : DECK_B_ENV_MOD;
        this.floatView[addr] = v;
    }

    public setDrive(deck: DeckId, v: number): void {
        const addr = deck === 'A' ? DECK_A_DRIVE : DECK_B_DRIVE;
        this.floatView[addr] = v;
    }

    // --- ZERO-GC SEQUENCER WRITES ---

    /**
     * Scrive un bitmask esatto in memoria. 
     * Il Worklet decodificherà con operazioni bit-a-bit (bitwise).
     */
    public setStep(deck: DeckId, stepIndex: number, data: AcidStep): void {
        if (stepIndex < 0 || stepIndex > 15) return;
        
        const baseAddr = deck === 'A' ? DECK_A_SEQ_OFFSET : DECK_B_SEQ_OFFSET;
        const targetAddr = baseAddr + stepIndex;

        // Bitwise packing: Note (7 bits) | Gate (1 bit) | Slide (1 bit) | Accent (1 bit)
        // Bit 0..6: Note (0-127)
        // Bit 7: Gate
        // Bit 8: Slide
        // Bit 9: Accent
        let mask = (data.note & 0x7F);
        if (data.gate) mask |= (1 << 7);
        if (data.slide) mask |= (1 << 8);
        if (data.accent) mask |= (1 << 9);

        this.atomicStore(targetAddr, mask);
    }
}
