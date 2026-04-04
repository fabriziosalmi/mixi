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
