// @ts-nocheck
import { TurboAcidBus } from './TurboAcidBus';

/**
 * Controller lato UI: Instanzia il DSP Aerospace-grade e gestisce il protocollo SAB.
 */
export class TurboAcidEngine {
    private ac: AudioContext;
    private acidWorklet: AudioWorkletNode | null = null;
    public readonly bus: TurboAcidBus;

    constructor(audioContext: AudioContext) {
        this.ac = audioContext;
        this.bus = new TurboAcidBus();
    }

    public async initialize(): Promise<void> {
        if (!this.ac) throw new Error("AudioContext required.");
        
        // N.B: Questo file "acid-core-processor.js" andrà compilato e servito.
        // Nel contesto di Mixi DAW lo pre-registriamo.
        try {
            await this.ac.audioWorklet.addModule('/audio-worklets/acid-core-processor.js');
            this.acidWorklet = new AudioWorkletNode(this.ac, 'acid-core-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1, // Uscita Stereo o Dual Mono (Deck A / Deck B)
                outputChannelCount: [2],
                processorOptions: {
                    // Passiamo il SharedArrayBuffer per la memoria Zero-Copy
                    memoryBuffer: this.bus.getSharedBuffer()
                }
            });

            // Master routing + DC Blocker/Limiter che avviene direttamente nel worklet
            // per la massima performance (come descritto nel readme).
            this.acidWorklet.connect(this.ac.destination);
            
        } catch (e) {
            console.error("[TurboAcid] Errore di caricamento o SAB disabilitato (Richiede COOP/COEP headers per SharedArrayBuffer).", e);
        }
    }

    public start(): void {
        if (this.ac.state === 'suspended') {
            this.ac.resume();
        }
        this.bus.setPlayState(true);
    }

    public stop(): void {
        this.bus.setPlayState(false);
    }

    public destroy(): void {
        this.stop();
        if (this.acidWorklet) {
            this.acidWorklet.disconnect();
            this.acidWorklet = null;
        }
    }
}
