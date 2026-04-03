/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

export { MixiEngine } from './MixiEngine';
export { AudioDeviceGuard } from './AudioDeviceGuard';
export { analyzeWaveform, POINTS_PER_SECOND } from './WaveformAnalyzer';
export { detectBpm } from './BpmDetector';
export { detectDrops } from './DropDetector';
export { detectKey, isHarmonicMatch } from './KeyDetector';
export { DeckChannel } from './nodes/DeckChannel';
export { MasterBus } from './nodes/MasterBus';
export { HeadphoneBus } from './nodes/HeadphoneBus';
export { smoothParam, SMOOTH_TIME_CONSTANT } from './utils/paramSmooth';
export { dbToGain, crossfaderGains, logFrequency, clamp } from './utils/mathUtils';
