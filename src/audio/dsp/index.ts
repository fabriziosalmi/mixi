/*
 * Mixi – DSP Abstraction Layer
 *
 * Central re-exports for the DSP processor system.
 */

// Core interfaces
export type {
  DspProcessor,
  DspParamBus,
  DspBackend,
  DspChain,
} from './DspProcessor';
export { LocalParamBus, SharedParamBus } from './DspProcessor';

// Parameter layout
export { DECK, DECK_A_BASE, DECK_B_BASE, MASTER, GLOBAL, PARAM_BUS_SIZE, deckParam } from './ParamLayout';

// Native processors (WebAudio adapters)
export { NativeDeckProcessor } from './NativeDeckProcessor';
export { NativeMasterProcessor } from './NativeMasterProcessor';

// Shared buffer bridge (Worklet communication)
export { createDspBuffers, sendBuffersToWorklet, isSharedBufferSupported, MeteringReader } from './SharedBufferBridge';
export type { DspSharedBuffers } from './SharedBufferBridge';

// Parameter writer
export { DspParamWriter } from './DspParamWriter';

// Wasm DSP bridge
export { WasmDspBridge } from './WasmDspBridge';
