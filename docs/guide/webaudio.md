# WebAudio API & Memory Handling

The `MixiEngine.ts` file acts as the ultimate master structure. 
Web Audio logic is highly un-opinionated in JavaScript, therefore Mixi strictly isolates all Audio Context interactions inside `src/audio/*`.

## Garbage Collection
Mixi leverages Node pooling for heavy `AudioBufferSourceNode` connections. To preserve memory and avoid memory leaks:
* Tracks are never loaded into RAM as multiple identical references (prevent OOM).
* A strict 200MB max size array buffer allocation is forced.
* Waveforms are cached safely after initial analysis.

## Zero-Latency Recording (`RecPanel.tsx`)
Mixi allows users to record live mix sessions seamlessly via `MediaRecorder`.
- **Codec**: WebM Opus natively derived from the WebAudio `MediaStreamAudioDestinationNode`.
- **Cue Lists**: Marks can be added dynamically and exported (track transitions, times, metadata).
- **Blob Handling**: Chunks are assembled sequentially without blocking the main JS thread, and downloading does not require backend interaction.