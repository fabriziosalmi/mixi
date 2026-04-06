# BEATMATCHING.md -- Piano Aerospaziale per il Miglior Beatmatching del Pianeta

> Obiettivo: Mixi deve avere il beatmatching piu preciso, veloce e resiliente
> mai implementato in un software DJ. Ogni decisione e giustificata da
> scienza del segnale, psicoacustica e 20 anni di errori altrui.

---

## STATO ATTUALE (v0.2.x)

### Cosa abbiamo

| Componente | Stato | Note |
|------------|-------|------|
| BPM detection JS | Buono | Onset + IOI histogram + octave resolution |
| BPM detection Rust/Wasm | Ottimo | Multi-band comb filter + PLL grid offset |
| Beatgrid | Base | Singolo `bpm` + `firstBeatOffset` (griglia fissa) |
| Sync | Funzionale | Tempo match + one-shot phase alignment |
| Phase meter | Solo AI blackboard | Non esposto come UI dedicata |
| Quantize | Funzionale | 1/1, 1/2, 1/4, 1/8, 1/16 beat snap |
| Key Lock | Funzionale | Pitch shifter AudioWorklet |
| Transport | Solido | Offset snapshot, loop wrap, slip mode |

### Cosa manca per essere i migliori

1. Beatgrid variabile (tracks con tempo changes)
2. Phase correction continua (PLL in tempo reale)
3. Phase meter UI dedicato
4. Micro-nudge con pitch bend temporaneo
5. Beat-accurate auto-cue (primo downbeat)
6. Sub-frame grid editing
7. Elastic beatgrid (warp markers)
8. Cross-correlation phase lock
9. Drift compensation a lungo termine

---

## FASE 1 -- FONDAMENTA (effort: medio, impatto: critico)

### 1.1 Phase Meter UI

Il phase meter e lo strumento numero uno per il beatmatching manuale.
Traktor lo ha, Rekordbox lo ha, Mixi lo deve avere meglio.

**Architettura:**
```
MixiEngine.getPhaseData(deckA, deckB) -> { deltaMs, deltaBeats, aligned }
```

**Calcolo (ogni 20ms nel rAF loop):**
```
masterBeat = (masterTime - masterOffset) / masterBeatPeriod
slaveBeat  = (slaveTime - slaveOffset) / slaveBeatPeriod
fracMaster = masterBeat % 1     (0.0 - 1.0)
fracSlave  = slaveBeat % 1      (0.0 - 1.0)
delta      = fracMaster - fracSlave
if delta >  0.5: delta -= 1
if delta < -0.5: delta += 1
deltaMs    = delta * masterBeatPeriod * 1000
```

**UI (Dual-Box Overlap -- superiore alla linea singola):**

Una singola linea mobile soffre di "Change Blindness": in un club buio
il DJ non capisce se il deck A e in anticipo o il B e in ritardo.

Soluzione: due rettangoli sovrapposti.

```
+-------------------------------+
|  [    ]  <- Master (contorno vuoto, fisso al centro)
|  [    ]  <- Slave (pieno, colorato, si muove L/R)
+-------------------------------+

Slave in ritardo:  [    ] spostato a SINISTRA  -> DJ deve "spingere" (nudge up)
Slave in anticipo: [    ] spostato a DESTRA    -> DJ deve "frenare" (nudge down)
Perfetto:          i due box si fondono in un BLOCCO BIANCO BRILLANTE
```

- Larghezza barra: 200px, centrata sopra il mixer
- Box master: contorno 2px, colore deck master, fisso al centro
- Box slave: pieno, colore deck slave, si muove proporzionalmente al deltaMs
- Lock state (|deltaMs| < 2ms): entrambi i box diventano bianco brillante
  con glow, nessun movimento residuo -- il DJ sa di essere "locked"
  senza leggere nulla
- Near-lock (|deltaMs| < 10ms): colore verde, movimento minimo
- Fuori fase (|deltaMs| > 30ms): colore rosso, box chiaramente separati

**Posizione:** Tra i BPM centrali e il vectorscope, o sotto i deck header.

### 1.2 Continuous Phase Lock (PLL Software)

Il sync one-shot attuale allinea la fase una volta e basta.
Ma il tempo reale accumula drift per:
- Imprecisione float64 del Web Audio clock
- Jitter del thread di rendering
- Micro-variazioni del playbackRate

**Soluzione: PLL (Phase-Locked Loop) software**

```
Ogni 50ms (nel tick del Blackboard):
  if deck.isSynced:
    phaseDelta = computePhaseDelta(master, slave)

    // Filtro proporzionale-integrale (PI controller)
    P = Kp * phaseDelta           // reazione immediata
    I = Ki * accumulatedError     // correzione drift lento
    correction = P + I

    // Applica come micro-nudge al playbackRate
    // Max ±0.1% per non essere udibile
    nudgedRate = baseRate * (1 + clamp(correction, -0.001, 0.001))
    smoothParam(source.playbackRate, nudgedRate, ctx)
```

**Costanti ottimali (da ricerca DSP):**
```
Kp = 0.02    // proporzionale: reazione rapida ma gentile
Ki = 0.001   // integrale: elimina errore stazionario in ~2s
deadzone = 0.005  // ignora delta < 0.5% di beat (inudibile)
maxCorrection = 0.001  // ±0.1% rate = impercettibile
integralMax = 0.05  // anti-windup clamp (vedi sotto)
```

**CRITICAL: Anti-Windup Protection**

L'accumulatore integrale I e una bomba a orologeria. Se il DJ tocca
la jog wheel o usa il nudge manuale mentre il SYNC e attivo, l'errore
di fase esplode. L'integrale accumula un valore enorme cercando di
compensare l'azione volontaria del DJ. Appena il DJ rilascia,
l'integrale "scarica" e la traccia schizza via a +15% di pitch
(Slingshot Effect), distruggendo il mix.

```
Ogni tick del PLL:
  // 1. FREEZE durante interazione umana
  if deck.isUserNudging || deck.isTouchingJog || deck.isScratching:
    accumulatedError = 0    // azzera la memoria del drift
    lastCorrection = 0      // reset output
    return baseRate          // nessuna correzione, il DJ comanda

  // 2. Anti-windup clamp (difesa secondaria)
  accumulatedError += phaseDelta * dt
  accumulatedError = clamp(accumulatedError, -integralMax, integralMax)

  // 3. Reset on large discontinuity (seek, hot cue, loop exit)
  if |phaseDelta - lastPhaseDelta| > 0.25:  // salto > 25% di beat
    accumulatedError = 0  // reset, non cercare di compensare un seek

  // 4. Calcolo normale PI
  P = Kp * phaseDelta
  I = Ki * accumulatedError
  correction = clamp(P + I, -maxCorrection, maxCorrection)
```

Tre livelli di protezione:
1. Freeze completo durante input umano (jog, nudge, scratch)
2. Clamp simmetrico dell'integrale (mai oltre ±0.05)
3. Reset su discontinuita (seek, hot cue jump, loop in/out)

**Perche batte tutti:**
- Traktor usa nudge discreti (udibili come "wobble")
- Rekordbox usa resync periodico (salto udibile)
- Mixi usa PLL continuo con anti-windup (zero artefatti, zero slingshot)

### 1.3 Pitch Bend Temporaneo (Nudge)

Per il beatmatching manuale, servono i tasti nudge.

**Comportamento:**
```
onNudgeDown(deck, direction):   // direction: +1 o -1
  tempRate = currentRate + direction * NUDGE_AMOUNT
  smoothParam(source.playbackRate, tempRate, ctx, 10ms)

onNudgeUp(deck):
  smoothParam(source.playbackRate, currentRate, ctx, 50ms)
```

**Parametri:**
```
NUDGE_AMOUNT = 0.04  // ±4% = chiaramente udibile, veloce da correggere
FINE_NUDGE   = 0.01  // ±1% = per ritocchi fini (Shift+tasto)
```

**Mappatura:**
- Tastiera: frecce SU/GIU per deck attivo
- MIDI: pitch bend wheel o bottoni dedicati
- Jog wheel: gia supportato come scratch, aggiungere modalita nudge

### 1.4 Smart Auto-Cue (Primo Downbeat)

Quando carichi una traccia, il playhead deve partire dal primo downbeat
significativo, non dal silenzio iniziale.

**Algoritmo (Grid-Snapped -- immune a reverse cymbal/riser):**

Il problema della soglia RMS pura: molte tracce hanno un reverse cymbal,
un riser o un respiro vocale che supera la soglia centinaia di ms prima
del vero downbeat. Il DJ preme play e parte fuori tempo.

Soluzione: l'audio e un indizio, la beatgrid e la legge.

```
findAutoCuePoint(buffer, bpm, firstBeatOffset):
  beatPeriod = 60 / bpm

  // STEP 1: Trova il primo superamento della soglia RMS (candidato grezzo)
  rawCueTime = null
  for beatNum = 0, 1, 2, ...:
    beatTime = firstBeatOffset + beatNum * beatPeriod
    window = buffer[beatTime - 5ms .. beatTime + 50ms]
    rms = computeRMS(window)
    if rms > SILENCE_THRESHOLD:
      rawCueTime = beatTime
      break

  if rawCueTime == null:
    return firstBeatOffset  // fallback assoluto

  // STEP 2: Trova il downbeat della beatgrid piu vicino
  beatsSinceOffset = (rawCueTime - firstBeatOffset) / beatPeriod
  nearestDownbeatNum = round(beatsSinceOffset / 4) * 4
  snappedCueTime = firstBeatOffset + nearestDownbeatNum * beatPeriod

  // STEP 3: Se il candidato grezzo e vicino a un downbeat, usa il downbeat
  if |rawCueTime - snappedCueTime| < 100ms:
    return snappedCueTime  // perfetto: grid-locked

  // STEP 4: Il candidato e lontano dal downbeat (riser/intro anomala)
  //         Cerca il PROSSIMO downbeat con energia sufficiente
  nextDown = ceil(beatsSinceOffset / 4) * 4
  for attempt = 0, 1, 2:  // prova 3 downbeat consecutivi
    candidateTime = firstBeatOffset + (nextDown + attempt * 4) * beatPeriod
    window = buffer[candidateTime - 5ms .. candidateTime + 50ms]
    if computeRMS(window) > SILENCE_THRESHOLD:
      return candidateTime

  // STEP 5: Nessun downbeat energetico trovato, usa il primo beat udibile
  return rawCueTime
```

**SILENCE_THRESHOLD:** -40dBFS (circa 0.01 in float)

---

## FASE 2 -- PRECISIONE MILITARE (effort: alto, impatto: alto)

### 2.1 Beatgrid Variabile (Variable-Tempo Tracks)

La maggior parte dei brani elettronici ha BPM costante.
Ma live recordings, vinili digitalizzati e musica organica no.

**Struttura dati:**
```typescript
interface BeatMarker {
  time: number;      // secondi (posizione esatta del beat)
  beatNum: number;   // numero progressivo del beat (0, 1, 2, ...)
  bpm: number;       // BPM locale da questo marker al prossimo
}

interface VariableBeatgrid {
  markers: BeatMarker[];   // ordinati per time
  // Il BPM tra marker[i] e marker[i+1] e markers[i].bpm
  // Per tracks a BPM costante: un solo marker
}
```

**Lookup efficiente:**
```
getBeatAtTime(grid, time):
  // Binary search per trovare il segmento
  idx = binarySearch(grid.markers, time, by: .time)
  marker = grid.markers[idx]
  localBpm = marker.bpm
  localPeriod = 60 / localBpm
  beatsElapsed = (time - marker.time) / localPeriod
  return marker.beatNum + beatsElapsed

getTimeAtBeat(grid, beat):
  // Binary search per trovare il segmento
  idx = binarySearch(grid.markers, beat, by: .beatNum)
  marker = grid.markers[idx]
  localPeriod = 60 / marker.bpm
  return marker.time + (beat - marker.beatNum) * localPeriod
```

**Rilevamento automatico:**
```
detectVariableTempo(buffer, initialBpm, initialOffset):
  beatPeriod = 60 / initialBpm
  markers = []

  // Analizza blocchi di 16 beat
  for chunk = 0, 16, 32, ...:
    chunkStart = initialOffset + chunk * beatPeriod
    chunkEnd = chunkStart + 16 * beatPeriod

    // Ri-analizza BPM locale con autocorrelazione
    localBpm = localBpmEstimate(buffer, chunkStart, chunkEnd)

    if |localBpm - initialBpm| > 0.5:  // soglia di variazione
      markers.push({ time: chunkStart, beatNum: chunk, bpm: localBpm })

  if markers.length <= 1:
    return null  // BPM costante, usa griglia fissa

  return { markers }
```

### 2.2 Cross-Correlation Phase Lock

Il metodo di fase basato su beat fraction funziona bene, ma ha un limite:
assume che i downbeat di entrambi i brani siano marcati correttamente.

La cross-correlazione e model-free: confronta direttamente il segnale.

**CRITICAL: Onset Flux, NON Audio Grezzo**

Cross-correlare l'audio raw (anche filtrato LP 200Hz) ha un difetto
fatale: se la traccia A ha un kick 808 (sub-bass da 500ms) e la B ha
un kick 909 (punch secco da 50ms), le forme d'onda sono diverse.
La correlazione allinea il "centro di massa" delle onde, sfasando
i transienti di attacco. Le due casse suonano come un galoppo.

Soluzione: cross-correla l'Onset Flux (il flusso dell'inviluppo),
non l'audio. L'onset flux cattura il MOMENTO dell'impatto ignorando
la forma della coda. Il modulo BPM Rust ha gia compute_onset_flux.

**Algoritmo (in Wasm per performance):**
```rust
fn cross_correlate_phase(
    master_buffer: &[f32],   // 2 beat di audio
    slave_buffer: &[f32],    // 2 beat di audio
    sample_rate: f32,
    max_shift_samples: usize // ±1 beat in samples
) -> f32 {  // offset ottimale in secondi (frazionario)

    // STEP 1: Calcola onset flux (NON usare audio grezzo)
    let master_flux = compute_onset_flux(master_buffer, sample_rate);
    let slave_flux = compute_onset_flux(slave_buffer, sample_rate);

    // STEP 2: Cross-correlazione sull'inviluppo
    let mut best_corr = f32::MIN;
    let mut best_shift = 0i32;

    for shift in -(max_shift_samples as i32)..=(max_shift_samples as i32) {
        let mut sum = 0.0f32;
        for i in 0..master_flux.len() {
            let j = (i as i32 + shift) as usize;
            if j < slave_flux.len() {
                sum += master_flux[i] * slave_flux[j];
            }
        }
        if sum > best_corr {
            best_corr = sum;
            best_shift = shift;
        }
    }

    // STEP 3: Parabolic interpolation per precisione sub-sample
    let (prev, next) = (
        correlate_at(best_shift - 1),
        correlate_at(best_shift + 1),
    );
    let refined = best_shift as f32
        + 0.5 * (prev - next) / (prev - 2.0 * best_corr + next);

    refined / sample_rate  // secondi
}

/// Onset flux: |delta RMS| in finestre da 10ms, solo incrementi positivi
fn compute_onset_flux(samples: &[f32], sr: f32) -> Vec<f32> {
    let hop = (sr * 0.01) as usize; // 10ms windows
    let mut prev_rms = 0.0f32;
    let mut flux = Vec::new();
    for chunk in samples.chunks(hop) {
        let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
        let delta = (rms - prev_rms).max(0.0); // solo onset (incrementi)
        flux.push(delta);
        prev_rms = rms;
    }
    flux
}
```

**Uso:**
```
Ogni 4 beat (quando entrambi i deck suonano):
  masterChunk = getAudioChunk(masterBuffer, masterTime, 2 * beatPeriod)
  slaveChunk = getAudioChunk(slaveBuffer, slaveTime, 2 * beatPeriod)
  offset = crossCorrelatePhase(masterChunk, slaveChunk, sampleRate, beatSamples)

  if |offset| > 5ms:
    // Alimenta il PLL con questo dato piu preciso della beatgrid
    pllInput = offset / beatPeriod  // converti in frazione di beat
```

**Vantaggi rispetto alla correlazione raw:**
- Allinea i TRANSIENTI (il click del kick), non la coda del basso
- Funziona con qualsiasi combinazione di kick (808+909, analog+digital)
- Funziona anche con beatgrid imprecise
- Costa ~0.3ms per 2 beat a 44.1kHz in Wasm (piu veloce del raw)

### 2.3 Drift Compensation a Lungo Termine

Dopo 10+ minuti di sync, anche ±0.001% di errore accumula ms di drift.

**Monitor:**
```
driftTracker = {
  startTime: Date.now(),
  initialPhaseDelta: 0,
  samples: RingBuffer(100),  // ultimi 100 campioni di phaseDelta
}

ogni 500ms:
  samples.push(phaseDelta)

  // Regressione lineare sui campioni
  slope = linearRegression(samples).slope  // ms/secondo di drift

  if |slope| > 0.01:  // >10us/s = drift sistematico
    // Correggi il playbackRate base (non il nudge)
    rateCorrection = -slope / (beatPeriod * 1000)
    baseRate += rateCorrection * 0.1  // applica 10% per iterazione
```

### 2.4 Beatgrid Editing UI

Per i casi in cui il rilevamento automatico sbaglia:

**Operazioni:**
```
Shift+Click sulla waveform:
  -> Sposta il primo downbeat (firstBeatOffset) al punto cliccato

Ctrl+Click sulla waveform:
  -> Imposta un marker di cambio BPM

Double-click su un beat marker:
  -> Apre mini-editor inline: [BPM: 128.00] [Offset: +0.012s]

Tasto TAP (T):
  -> Tap tempo manuale: media degli ultimi 8 tap
  -> Sovrascrive il BPM rilevato
```

---

## FASE 3 -- SUPERPOTERI (effort: alto, impatto: differenziante)

### 3.1 Predictive Phase Alignment

Invece di correggere il drift dopo che si verifica, prevederlo.

**Modello predittivo:**
```
Il Web Audio clock ha pattern di jitter riconoscibili:
- Garbage collection pauses (periodiche, ~10-50ms)
- Tab throttling (quando il browser perde focus)
- CPU thermal throttling (graduale, rilevabile)

predictedDrift(history):
  // FFT sui campioni di drift per trovare periodicita
  spectrum = fft(driftSamples)
  dominantFreq = argmax(spectrum)

  // Estrapolazione: dove sara la fase tra 100ms?
  predicted = currentDelta + slope * 0.1 + amplitude * sin(dominantFreq * nextTime)

  // Pre-compensazione
  return -predicted * 0.5  // applica meta della correzione predetta
```

### 3.2 Harmonic Sync (Sync su frazioni di beat)

Per generi come drum & bass (170 BPM) mixati con house (128 BPM),
il sync classico non funziona. Serve sync armonico.

**Rapporti supportati:**
```
1:1   = stesso tempo (standard)
2:1   = master doppio dello slave (DnB su halftime)
1:2   = master meta dello slave
3:4   = polyrhythmic sync (triplet feel)
4:3   = inverso
```

**Rilevamento automatico:**
```
findBestRatio(masterBpm, slaveBpm):
  ratios = [1, 2, 0.5, 1.5, 0.75, 4/3, 3/4]

  bestRatio = 1
  bestError = Infinity

  for ratio in ratios:
    targetBpm = masterBpm * ratio
    error = |slaveBpm - targetBpm|
    if error < bestError && error < 5:  // max 5 BPM di scarto
      bestError = error
      bestRatio = ratio

  return bestRatio
```

**CRITICAL: Logical Phase Multiplier (NON time-stretch)**

Portare una traccia a playbackRate 2.0 (anche con preservesPitch / WSOLA)
distrugge i transienti: suona come un frullatore metallico.
E inascoltabile a livello professionale.

Soluzione: NON cambiare la velocita della traccia. Cambia la MATEMATICA
del sync. La traccia slave continua a suonare alla sua velocita naturale,
ma il motore moltiplica la sua griglia virtuale per il rapporto armonico.

```
syncWithRatio(slave, master, ratio):
  // NON FARE: slave.playbackRate = 2.0  (DISTRUGGE L'AUDIO)

  // La traccia suona alla sua velocita naturale
  // Solo il pitch fine-tune per allineare al rapporto armonico
  targetBpm = master.bpm / ratio  // es: 170 / 2 = 85 BPM target per slave
  fineRate = targetBpm / slave.originalBpm  // es: 85 / 84.5 = 1.006
  slave.playbackRate = clamp(fineRate, 0.92, 1.08)  // solo micro-adjust

  // Il PLL e il phase meter usano una griglia VIRTUALE moltiplicata
  virtualSlaveBeatPeriod = (60 / slave.bpm) / ratio
  // Cosi la meta-traccia (85 BPM) batte esattamente ogni 2 kick
  // della traccia intera (170 BPM)

  // Phase alignment con periodo virtuale
  slaveFrac = ((slaveTime - slaveOffset) / virtualSlaveBeatPeriod) % 1
  // ... resto identico al sync standard
```

**Risultato:**
- Audio purissimo (zero artefatti di time-stretch)
- Rate change < ±8% (nel range del pitch fader)
- Sync matematicamente bloccato sul rapporto armonico
- Il DJ sente entrambe le tracce al loro tempo naturale

### 3.3 Intelligent BPM Doubling/Halving Resolution

Uno dei problemi piu comuni: il detector dice 86 BPM ma la traccia
e chiaramente 172 BPM (drum & bass). O 65 BPM quando e 130 (half-time).

**Sistema di voto multi-segnale:**
```
resolveOctave(detectedBpm, buffer):
  candidates = [detectedBpm, detectedBpm * 2, detectedBpm / 2]

  scores = candidates.map(bpm => {
    beatPeriod = 60 / bpm

    // 1. Grid alignment score (quanti onset cadono sulla griglia)
    gridScore = countAlignedOnsets(buffer, bpm) / totalOnsets

    // 2. Genre range score (bonus per range DJ standard)
    rangeScore = bpm >= 100 && bpm <= 180 ? 1.0 : 0.5

    // 3. Kick pattern score (analisi spectrale < 100Hz)
    kickScore = kickPatternMatch(buffer, bpm)

    // 4. Hi-hat regularity (> 8kHz, dovrebbe essere su ogni beat o meta)
    hihatScore = hihatRegularity(buffer, bpm)

    // 5. Snare backbeat (snare su beat 2 e 4? tipico 4/4)
    snareScore = snareBackbeatScore(buffer, bpm)

    return gridScore * 0.3 + rangeScore * 0.15 + kickScore * 0.25
           + hihatScore * 0.15 + snareScore * 0.15
  })

  return candidates[argmax(scores)]
```

### 3.4 Zero-Latency Sync Engage

Quando premi SYNC, il tempo tra il press e l'allineamento deve essere
inferiore a 1 frame audio (< 5ms a 44.1kHz con buffer 256).

**Tecnica: pre-calcolo + scheduled seek**
```
onSyncPress(deck):
  // 1. Calcola fase istantanea (< 0.1ms)
  delta = computePhaseDelta(master, slave)

  // 2. Calcola il seek target
  seekOffset = delta * slaveBeatPeriod
  targetTime = currentTime + seekOffset

  // 3. Schedula il seek al prossimo beat del master
  //    (piu musicale di un seek immediato)
  if quantize:
    nextMasterBeat = ceil(masterBeat)
    scheduledTime = getTimeAtBeat(masterGrid, nextMasterBeat)
    waitMs = (scheduledTime - masterTime) * 1000
    scheduleSeek(deck, targetTime, waitMs)
  else:
    seek(deck, targetTime)  // immediato

  // 4. Attiva PLL per mantenimento
  enablePLL(deck)
```

### 3.5 Waveform Phase Overlay

Mostrare visivamente come le waveform dei due deck si sovrappongono.

**Implementazione:**
```
Nel draw loop della waveform del deck A:
  if showPhaseOverlay && otherDeckPlaying:
    // Disegna la waveform del deck B in semitrasparenza
    ctx.globalAlpha = 0.15
    ctx.globalCompositeOperation = 'screen'

    for each bar:
      otherTime = convertBeatPosition(masterBeat, slaveGrid)
      otherIdx = otherTime * POINTS_PER_SECOND
      // Disegna con colore dell'altro deck
      drawBar(otherIdx, otherDeckColor)

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
```

---

## FASE 4 -- RESILIENZA (effort: medio, impatto: critico per live)

### 4.1 Graceful Degradation

Cosa succede quando il browser lagga? Il beatmatching non deve rompersi.

**Livelli di fallback:**
```
LIVELLO 1 (normale):
  PLL attivo, phase meter 60fps, cross-correlation ogni 4 beat

LIVELLO 2 (CPU > 80%):
  PLL attivo, phase meter 30fps, cross-correlation disabilitata

LIVELLO 3 (CPU > 95% o tab in background):
  PLL attivo con intervallo raddoppiato (100ms)
  Phase meter disabilitato
  Nessun overlay

LIVELLO 4 (AudioContext glitch):
  Hard resync: ricalcola fase e fai seek correttivo
  Log warning per l'utente
```

**Rilevamento:**
```
let lastTickTime = 0
onTick():
  now = performance.now()
  jitter = now - lastTickTime - EXPECTED_INTERVAL
  lastTickTime = now

  if jitter > 50ms:
    degradationLevel = Math.min(4, degradationLevel + 1)
  else if jitter < 10ms:
    degradationLevel = Math.max(1, degradationLevel - 1)
```

### 4.2 Audio Clock vs System Clock Reconciliation

`AudioContext.currentTime` e `performance.now()` possono divergere,
specialmente con audio interface esterne.

**Monitor:**
```
calibration = {
  audioTimeAtSync: ctx.currentTime,
  perfTimeAtSync: performance.now(),
  clockRatio: 1.0,  // audio_clock_speed / system_clock_speed
}

ogni 10 secondi:
  expectedAudioElapsed = (performance.now() - calibration.perfTimeAtSync) / 1000
  actualAudioElapsed = ctx.currentTime - calibration.audioTimeAtSync

  newRatio = actualAudioElapsed / expectedAudioElapsed
  calibration.clockRatio = lerp(calibration.clockRatio, newRatio, 0.1)

  if |calibration.clockRatio - 1.0| > 0.001:
    // Compensa nel calcolo di getCurrentTime
    // Questo corregge drift su audio interface con clock leggermente
    // diverso da 44100/48000 Hz esatti
```

### 4.3 Sync Recovery After Glitch

Se l'AudioContext ha un underrun (buffer starvation), la posizione
di playback salta. Serve recovery automatico.

**Rilevamento:**
```
lastKnownPosition = getCurrentTime(deck)

onAudioProcess():  // ogni render quantum (128 samples)
  currentPos = getCurrentTime(deck)
  expectedPos = lastKnownPosition + (128 / sampleRate) * playbackRate

  if |currentPos - expectedPos| > 10ms:
    // GLITCH DETECTED
    emit('sync:glitch', { deck, expected: expectedPos, actual: currentPos })

    if isSynced:
      // Re-align immediatamente
      scheduleMicroResync(deck, 'glitch-recovery')

  lastKnownPosition = currentPos
```

---

## FASE 5 -- INTELLIGENZA ACUSTICA 1000x (effort: variabile, impatto: alieno)

Oltre il beatmatching tradizionale. Queste feature non esistono in nessun
software DJ. Abbandonano il concetto di "traccia A vs traccia B" e
abbracciano l'Intelligenza Acustica Predittiva e il Micro-Timing Umano.

### 5.1 Groove Offset (Il Tocco Dilla)

Il beatmatching matematico perfetto (0ms di errore) a volte suona "sterile".
Due casse perfettamente allineate possono causare cancellazione di fase
(bass drop-out) o suonare meccaniche. I veri DJ a volte tengono
volutamente un piatto leggermente in anticipo (Pushing) per dare urgenza.

**Implementazione:**
```
// Groove offset configurabile: -10ms a +10ms (default: 0)
grooveOffset = settings.grooveOffsetMs  // es. +3ms

// Il PLL non punta piu a delta=0 ma a delta=target
targetDelta = grooveOffset / (beatPeriod * 1000)  // converti ms -> frazione

Ogni tick del PLL:
  error = phaseDelta - targetDelta  // errore rispetto al target, non allo zero
  P = Kp * error
  I = Ki * accumulatedError
  // ... resto identico
```

**UI:** Micro-knob "GROOVE" nel phase meter, range -10ms a +10ms.
Default 0. Il DJ lo gira a +3ms e il mix acquista immediatamente
un tiro (drive) che nessun software concorrente puo dare.

**Preset di groove:**
```
STRAIGHT  =  0ms   // perfetto, pulito
PUSH      = +3ms   // urgenza, corsa (Techno peak time)
LAY BACK  = -3ms   // rilassato, laid back (Deep House)
DILLA     = +5ms   // swing aggressivo (Hip-hop, Broken Beat)
```

### 5.2 Phase Cancellation Defense (Auto-Nudge di Sopravvivenza)

Se due tracce hanno la cassa accordata sulla stessa frequenza fondamentale
(es. 50Hz) e il PLL le allinea a 0ms, potrebbero essere in controfase
perfetta: una spinge il cono del subwoofer in fuori, l'altra in dentro.
Il basso letteralmente scompare dal club. Il pubblico sente solo i medi.

**Rilevamento (in Wasm, ogni 2 beat):**
```rust
fn detect_phase_cancellation(
    master_low: &[f32],  // LP < 100Hz, 2 beat
    slave_low: &[f32],   // LP < 100Hz, 2 beat
) -> bool {
    let rms_master = rms(master_low);
    let rms_slave = rms(slave_low);
    let sum_rms = rms(&add(master_low, slave_low));

    let expected_sum = (rms_master * rms_master + rms_slave * rms_slave).sqrt();

    // Se la somma e significativamente minore dell'aspettato:
    // cancellazione di fase in corso
    sum_rms < expected_sum * 0.6  // soglia: 40% di energia persa
}
```

**Correzione automatica:**
```
ogni 2 beat (se isSynced && entrambi i bassi a volume > 0):
  if detectPhaseCancellation(masterLow, slaveLow):
    // Micro-nudge d'emergenza: sposta di 2ms (invisibile all'orecchio,
    // ma sufficiente a rompere la controfase)
    emergencyOffset = 0.002  // 2ms
    pllTarget += emergencyOffset / beatPeriod

    // Log per UI (piccolo indicatore "PHASE FIX" che lampeggia)
    emit('sync:phase-fix')

    // Se anche +2ms non risolve (raro), prova -2ms
    if stillCancelling after 4 beats:
      pllTarget -= emergencyOffset * 2 / beatPeriod
```

**UI:** Micro-indicatore nel phase meter: "PH" lampeggia in giallo
quando la difesa si attiva. Il DJ sa che il sistema lo sta proteggendo.

### 5.3 Phrase Lock (Sync Strutturale)

Sincronizzare i battiti e facile. Sincronizzare le FRASI musicali e cio
che separa un mix amatoriale da uno da festival.

Il Sync attuale allinea beat a beat. Ma se il Battito 1 della traccia A
finisce sul Battito 3 della traccia B, suonano a tempo ma i cambi di
struttura (ogni 16/32 beat) sono sfalsati. Il mix fa schifo.

**Architettura:**
```
// Gia disponibile nel Blackboard:
masterBeatInPhrase = (masterBeat % 16 + 16) % 16  // 0-15
masterBeatsToPhrase = 16 - masterBeatInPhrase       // beat al prossimo "1"

// Per Phrase Lock:
phraseLock(slave, master):
  // 1. Calcola la posizione nella frase di entrambi
  masterPhrase = masterBeatInPhrase   // es. beat 12 su 16
  slavePhrase = (slaveBeat % 16 + 16) % 16  // es. beat 4 su 16

  // 2. Offset necessario per allineare le frasi
  phraseOffset = masterPhrase - slavePhrase  // es. 12 - 4 = 8 beat
  if phraseOffset > 8: phraseOffset -= 16    // wrap per shortest path
  if phraseOffset < -8: phraseOffset += 16

  // 3. Seek dello slave di N beat per allineare la struttura
  seekOffset = phraseOffset * beatPeriod
  seek(slave, currentSlaveTime + seekOffset)
```

**Modalita:**
```
BEAT SYNC   = allinea solo i beat (default, come ora)
PHRASE SYNC = allinea beat + frase 16-beat (cambi strutturali sincronizzati)
BAR SYNC    = allinea beat + barra 4-beat (meno aggressivo)
```

**UI:** Toggle tri-stato nel pannello sync: [BEAT | BAR | PHRASE]

### 5.4 Drop-to-Drop Auto-Align (La Matrice)

Il Drop Detector e gia in Wasm (dropBeats[] nel DeckState).
Quando carichi una traccia sul Deck B, Mixi calcola quanti beat
mancano al Drop del Deck A e quanti ne servono al Deck B per arrivare
al suo Drop. Un tasto "ALIGN DROPS" posiziona la testina del Deck B
in modo che i due drop esplodano nello stesso millisecondo.

**Algoritmo:**
```
alignDrops(master, slave):
  // 1. Trova il prossimo drop del master
  masterDropBeat = master.dropBeats.find(d =>
    d > currentMasterBeat  // prossimo drop futuro
  )
  if !masterDropBeat: return  // nessun drop rilevato

  // 2. Trova il drop principale dello slave (di solito il primo)
  slaveDropBeat = slave.dropBeats[0]
  if !slaveDropBeat: return

  // 3. Calcola i beat rimanenti
  masterBeatsToGo = masterDropBeat - currentMasterBeat
  slaveBeatsToGo = slaveDropBeat - 0  // dal cue point (inizio)

  // 4. Posiziona lo slave in modo che i due countdown coincidano
  slaveStartBeat = slaveDropBeat - masterBeatsToGo
  slaveStartTime = getTimeAtBeat(slaveGrid, slaveStartBeat)

  // 5. Se slaveStartBeat < 0, non c'e abbastanza intro -> avvisa
  if slaveStartTime < 0:
    emit('align:insufficient-intro', { deficit: -slaveStartBeat })
    return

  // 6. Seek e attiva sync
  seek(slave, slaveStartTime)
  syncDeck(slave)
  emit('align:drops-locked', { beatsToGo: masterBeatsToGo })
```

**UI:** Bottone "ALIGN" tra i due deck. Quando premuto:
- Icona bersaglio lampeggia
- Countdown condiviso appare sopra il mixer: "DROP IN: 64 beats"
- I drop marker sulle waveform si illuminano di rosso

### 5.5 Cross-Sync Invisibile (Seek senza glitch)

Riferimento: migliora 3.4 Zero-Latency Sync Engage

Il seek attuale fa un micro-fade di 5ms. Ma se c'e una voce che canta,
il salto temporale taglia una vocale ("Voo-[salto]-ce").

**Soluzione: doppio nodo con crossfade**
```
onSyncEngage(deck):
  // 1. Calcola target position
  targetTime = computeSyncTarget(master, slave)

  // 2. NON fermare il nodo corrente. Crea un SECONDO nodo.
  newSource = ctx.createBufferSource()
  newSource.buffer = transport.buffer
  newSource.playbackRate.value = transport.playbackRate
  connectSource(deck, newSource)

  // 3. Crossfade: vecchio fade-out, nuovo fade-in (50ms)
  oldTrim.gain.linearRampToValueAtTime(0, now + 0.05)
  newSource.start(now, targetTime)
  newTrim.gain.setValueAtTime(0, now)
  newTrim.gain.linearRampToValueAtTime(trimLevel, now + 0.05)

  // 4. Dopo 50ms, disconnetti il vecchio nodo
  setTimeout(() => {
    oldSource.stop()
    oldSource.disconnect()
  }, 60)

  // 5. Il nuovo nodo e ora il nodo attivo
  transport.source = newSource
  transport.offset = targetTime
  transport.startedAt = now
```

**Risultato:** L'orecchio umano non sente il "taglio" del seek.
Sente solo la traccia che "scivola" magicamente a tempo in 50ms.
Funziona anche con voci, pad, strings -- qualsiasi materiale tonale.

### 5.6 Shift Grid (Fix rapido errori di analisi)

Il 90% degli errori di beatgrid sono "griglia giusta, downbeat sbagliato":
la cassa cade sul beat 2 invece che sul beat 1.

**Implementazione:**
```
shiftGrid(deck, direction):  // direction: +1 o -1 beat
  beatPeriod = 60 / deck.bpm
  deck.firstBeatOffset += direction * beatPeriod

  // Clamp: non andare prima dell'inizio del file
  if deck.firstBeatOffset < 0:
    deck.firstBeatOffset += beatPeriod * 4  // wrap a +3 beat

  // Se synced, ricalcola fase
  if deck.isSynced:
    realignPhase(deck)
```

**UI:** Due frecce < > nella waveform header, o shortcut:
- Shift+Left: griglia -1 beat
- Shift+Right: griglia +1 beat
- Shift+Up: griglia -1/4 beat (fine adjust)
- Shift+Down: griglia +1/4 beat (fine adjust)

Risolve il problema in mezzo secondo durante un set live.

### 5.7 Differential Phase Overlay (Ghost Deck Anaglifo)

Riferimento: migliora 3.5 Waveform Phase Overlay

Non limitarsi a disegnare la traccia B in semitrasparenza sopra A.
Usare l'approccio differenziale: il canvas calcola la differenza
di energia tra i kick delle due tracce.

**Implementazione:**
```
// Nel draw loop della waveform:
if showPhaseOverlay && otherDeckPlaying:
  for each bar:
    masterEnergy = waveformA[dataIdx].low  // energia kick master
    slaveEnergy = waveformB[otherIdx].low  // energia kick slave

    // Differenza di energia normalizzata
    diff = masterEnergy - slaveEnergy  // -1..+1

    if |diff| < 0.1:
      // ALLINEATE: bianco solido (somma costruttiva)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * masterEnergy})`
    else if diff > 0:
      // Master domina: rosso (deck A in anticipo)
      ctx.fillStyle = `rgba(255, 60, 60, ${0.25 * |diff|})`
    else:
      // Slave domina: ciano (deck B in anticipo)
      ctx.fillStyle = `rgba(0, 240, 255, ${0.25 * |diff|})`

    ctx.fillRect(x, halfHeight - h, BAR_WIDTH, h * 2)
```

**Effetto visivo:**
- Kick allineati: blocco BIANCO SOLIDO (il DJ vede "locked")
- Kick sfasati: sfrigolamento ROSSO/CIANO stile anaglifo 3D
- Il DJ non deve leggere numeri: il COLORE urla se e a tempo o no

### 5.8 Phase Meter Vibration (Allarme Periferico)

Il phase meter e freddo e matematico. La visione periferica del DJ
in un club buio non legge barre orizzontali.

**Implementazione:**
```css
/* Quando errore > 15ms (soglia flam udibile) */
.phase-meter--warning {
  animation: phase-shake 0.1s ease-in-out infinite;
}

@keyframes phase-shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-1px); }
  75%      { transform: translateX(1px); }
}
```

```
// Nel componente PhaseMeter:
const shakeClass = Math.abs(deltaMs) > 15 ? 'phase-meter--warning' : ''

// Jog wheel flicker: abbassa luminosita del 5% e torna su
if Math.abs(deltaMs) > 15:
  jogWheelOpacity = 0.95 + 0.05 * sin(performance.now() * 0.02)
```

**Livelli di allarme:**
```
|deltaMs| < 5ms:    nessun feedback (perfetto)
|deltaMs| 5-15ms:   phase meter diventa arancione (warning morbido)
|deltaMs| 15-30ms:  vibrazione + jog wheel flicker (allarme)
|deltaMs| > 30ms:   vibrazione forte + waveform border rosso (critico)
```

Il cervello umano rileva il movimento periferico molto prima di
decifrare una barra orizzontale. Questo allarme e biologicamente
impossibile da ignorare.

---

## PRIORITA DI IMPLEMENTAZIONE

### Sprint 1 -- Settimana corrente (fondamenta)
1. Phase Meter UI con dual-box (1.1) -- il singolo cambio piu impattante
2. Pitch Bend / Nudge (1.3) -- necessario per beatmatching manuale
3. Smart Auto-Cue grid-snapped (1.4) -- qualita della vita
4. Shift Grid ±1 beat (5.6) -- fix rapido errori analisi

### Sprint 2 -- Prossima settimana (PLL + resilienza)
5. PLL Continuo con anti-windup (1.2) -- il salto di qualita nel sync
6. Groove Offset (5.1) -- il tocco umano
7. Drift Compensation (2.3) -- necessario per set lunghi
8. Audio Clock Reconciliation (4.2) -- resilienza

### Sprint 3 -- Medio termine (intelligenza acustica)
9. Onset Flux Cross-Correlation (2.2) -- precisione militare
10. Phase Cancellation Defense (5.2) -- salvavita invisibile
11. Phrase Lock (5.3) -- sync strutturale
12. Phase Meter Vibration (5.8) -- allarme periferico

### Sprint 4 -- Medio-lungo termine (struttura)
13. Beatgrid Variabile (2.1) -- supporto tracks live
14. Beatgrid Editing UI (2.4) -- controllo manuale
15. Drop-to-Drop Auto-Align (5.4) -- la matrice
16. Cross-Sync Invisibile (5.5) -- seek senza glitch

### Sprint 5 -- Lungo termine (superpoteri)
17. Harmonic Sync con Phase Multiplier (3.2) -- multi-genere
18. Predictive Phase (3.1) -- precognizione
19. Differential Phase Overlay (5.7) -- ghost deck anaglifo
20. Waveform Phase Overlay (3.5) -- ciliegina sulla torta

---

## METRICHE DI SUCCESSO

| Metrica | Traktor | Rekordbox | Mixi Target |
|---------|---------|-----------|-------------|
| Tempo di convergenza sync | ~200ms | ~300ms | < 50ms |
| Drift dopo 10 minuti | ±15ms | ±20ms | < 2ms |
| Precisione phase meter | ±5ms | ±10ms | ±1ms |
| Latenza nudge | ~10ms | ~15ms | < 5ms |
| Recovery dopo glitch | Manuale | ~500ms | < 100ms |
| Risorse CPU (sync attivo) | ~3% | ~4% | < 1% |
| Phase cancellation detect | No | No | < 500ms |
| Phrase alignment | No | No | ±0 beat |
| Groove offset range | No | No | ±10ms |
| Seek glitch (crossfade) | ~5ms click | ~10ms | 0ms (50ms xfade) |

---

## NOTE TECNICHE

### Perche il PLL batte il resync periodico

Il resync periodico (usato da Rekordbox) funziona cosi:
```
ogni 2 secondi:
  if |phaseDelta| > 20ms:
    seek(slave, correctPosition)  // CLICK UDIBILE
```

Il PLL funziona cosi:
```
ogni 50ms:
  rate += Kp * error + Ki * integral
  // Correzione continua, max ±0.1%, IMPERCETTIBILE
```

Il PLL converge esponenzialmente senza artefatti udibili.
La costante di tempo e ~500ms per errori < 20ms e ~2s per errori > 50ms.

### Perche l'onset flux batte la cross-correlazione raw

Il beat fraction method assume:
- Il BPM e corretto
- Il firstBeatOffset e corretto
- La beatgrid e lineare

La cross-correlazione raw (su audio filtrato) elimina queste assunzioni
ma ne introduce una nuova: che le forme d'onda dei kick siano simili.
Un 808 (sub 500ms) vs un 909 (punch 50ms) produce "shape mismatch"
e allinea i centri di massa, non i transienti.

L'onset flux correlation risolve tutto:
- Non dipende dalla beatgrid
- Non dipende dalla forma del kick
- Allinea i transienti di attacco (il "click")
- Funziona con BPM variabile e kick diversi
- Costa ~0.3ms per 2 beat a 44.1kHz in Wasm

### Psicoacustica del beatmatching

- < 5ms di sfasamento: impercettibile (sotto la risoluzione temporale umana)
- 5-15ms: percepibile solo come "ampiezza" del kick (effetto flam)
- 15-30ms: chiaramente sfasato, suona come doppio colpo
- > 30ms: due kick distinti, mix rovinato

Target Mixi: mantenere lo sfasamento sotto 5ms in tutte le condizioni.
Questo e il livello "aerospaziale".

---

## EDGE CASES LETALI (Audit DSP)

Cinque trappole mortali che distruggono il beatmatching in ambiente live.
Ogni fix e integrato nelle sezioni sopra ma qui riassumiamo per audit.

### EC-1: PLL Integral Windup (Slingshot Effect)
**Sezione:** 1.2
**Trigger:** DJ tocca jog wheel durante sync attivo per 3+ secondi
**Sintomo:** Alla release, traccia schizza a +15% di pitch
**Fix:** Triple protection: freeze durante input, integral clamp ±0.05,
reset su discontinuita (seek/hotcue/loop)

### EC-2: Cross-Correlation Shape Mismatch
**Sezione:** 2.2
**Trigger:** Traccia A con kick 808 (sub lungo), traccia B con kick 909 (secco)
**Sintomo:** Kick allineati sul centro di massa, non sul transiente -> galoppo
**Fix:** Onset flux correlation invece di raw audio correlation

### EC-3: Auto-Cue False Positive (Riser/Reverse Cymbal)
**Sezione:** 1.4
**Trigger:** Traccia con reverse cymbal 500ms prima del drop
**Sintomo:** Auto-cue piazzato mezzo secondo prima del beat reale
**Fix:** Grid-snapped auto-cue: l'audio e un indizio, la beatgrid e la legge.
Snap al downbeat piu vicino se entro 100ms.

### EC-4: Harmonic Sync Time-Stretch Destruction
**Sezione:** 3.2
**Trigger:** Sync 170 BPM con 85 BPM -> playbackRate 2.0
**Sintomo:** Audio distrutto, transienti metallici, inascoltabile
**Fix:** Logical Phase Multiplier: la traccia suona al suo tempo naturale,
solo la griglia virtuale viene moltiplicata per il rapporto armonico.

### EC-5: Phase Meter Change Blindness
**Sezione:** 1.1
**Trigger:** DJ in club buio guarda linea verticale ferma a +10%
**Sintomo:** Non capisce se A e in anticipo o B in ritardo
**Fix:** Dual-box overlap: box master vuoto fisso + box slave pieno mobile.
Lock state = fusione in blocco bianco brillante.
