# TurboBass — TODO

## Tier 1 — Sonoro (cambiano il carattere dello strumento)

- [ ] **Pattern chaining** — Concatenare pattern in sequenza (es. A01→A03→B02) per frasi lunghe. Aggiungere un chain editor e un modo di playback che avanza automaticamente al pattern successivo nella catena.
- [ ] **Per-step parameter locks** — Cutoff, resonance, decay diversi per ogni step (stile Elektron). Ogni JS303Step puo avere un campo opzionale `locks: Partial<Record<SynthParamId, number>>` applicato solo durante quello step.
- [ ] **Sidechain duck** — Il bass si abbassa quando il kick dell'altro deck suona. Rilevare i transienti del deck opposto via AnalyserNode e modulare il VCA del TurboBass con un envelope follower.
- [ ] **Delay LP nel feedback loop** — Aggiungere un BiquadFilter lowpass nel loop del delay (dopo il HP gia presente). Ogni ripetizione diventa progressivamente piu scura e calda. Cutoff del LP controllabile (o fisso a ~4kHz).

## Tier 2 — Performance live

- [ ] **MUTE modifier** — Per-step palm mute: gate piu corto (50%) + cutoff abbassato (-2 ottave) per lo step. Aggiungere `mute: boolean` a JS303Step e gestire in tick(). UI: riga MUT nel sequencer.
- [ ] **Pattern morph** — Transizione graduale tra pattern corrente e un target. Interpolazione probabilistica: ad ogni ciclo, ogni step ha una probabilita crescente di essere sostituito dal corrispondente del target. Controllabile con un knob (0=corrente, 1=target).
- [ ] **Undo/Redo** — Stack di stati del pattern. Ogni modifica (updateStep, randomize, mutate, paste) pusha lo stato precedente nello stack. Max 20 livelli. Bottoni UNDO/REDO nel transport.
- [ ] **Scatter** — Effetti glitch sincronizzati al BPM: reverse (invertire direzione playback), stutter (ripetere lo step corrente N volte), gate (silenziare a intervalli), half-speed, tape-stop. Trigger via bottoni o automazione.

## Tier 3 — Visualizzazione

- [ ] **Oscilloscope** — Forma d'onda in tempo reale nel canvas del filtro. Usare AnalyserNode.getFloatTimeDomainData() sul segnale post-VCA. Disegnare nel canvas esistente sovrapposto alla curva del filtro. Toggle tra vista filtro e oscilloscopio.
- [ ] **Spectrum analyzer** — FFT del segnale post-filtro. AnalyserNode.getFloatFrequencyData() con fftSize=2048. Visualizzazione a barre logaritmiche (20Hz–20kHz) nel canvas. Mostra dove il filtro sta tagliando in tempo reale.
