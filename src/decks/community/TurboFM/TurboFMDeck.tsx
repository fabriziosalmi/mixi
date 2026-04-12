import { useState, useEffect, useRef, FC } from 'react';
import { TurboFMEngine, DeckId } from './TurboFMEngine';
import { TurboFMSnapshot, defaultSynth, defaultFx, defaultSteps } from './types';

export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

export interface KnobProps { value: number; label: string; onChange: (v: number) => void; size?: string; }
const Knob: FC<KnobProps> = ({ value, label, onChange }) => (
  <div className="flex flex-col items-center gap-1 group">
    <span className="text-[10px] text-gray-500 font-mono tracking-wider group-hover:text-gray-300 transition-colors uppercase truncate max-w-[60px]">{label}</span>
    <input 
      type="range" min="0" max="1" step="0.01" 
      value={value} onChange={e => onChange(parseFloat(e.target.value))}
      className="w-12 h-1 bg-gray-800 rounded-full appearance-none outline-none cursor-pointer accent-white hover:accent-gray-300 transition-all"
    />
  </div>
);

export const TurboFMDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboFMSnapshot>({
    isPlaying: false,
    currentStep: -1,
    bpm: 120,
    syncToMaster: true,
    steps: defaultSteps(),
    synth: defaultSynth(),
    fx: defaultFx(),
    masterVolume: 1.0,
    swing: 0,
  });

  const engineRef = useRef<TurboFMEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboFMEngine(deckId);
    const ctx = new window.AudioContext();
    
    let isMounted = true;
    engine.init(ctx).then(() => {
      if (isMounted) {
        engineRef.current = engine;
        engine.onStepChange = (step) => {
          setSnapshot(s => ({ ...s, currentStep: step }));
        };
        setIsReady(true);
      }
    });

    return () => {
      isMounted = false;
      engine.destroy();
      ctx.close();
    };
  }, [deckId]);

  const handleMutateSeq = () => {
    if (!engineRef.current) return;
    engineRef.current.mutateSequence();
    setSnapshot(s => ({ ...s, steps: [...engineRef.current!.steps] }));
  };

  const handleMutateSynth = () => {
    if (!engineRef.current) return;
    engineRef.current.mutateParams();
    setSnapshot(s => ({ ...s, synth: { ...engineRef.current!.synthParams } }));
  };

  if (!isReady || !engineRef.current) {
    return (
      <div className="flex flex-col h-full w-full bg-black/40 text-white rounded-lg p-4 font-mono items-center justify-center border border-gray-800">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-t-2 border-b-2" style={{ borderColor: color, animation: 'spin 1s linear infinite' }} />
          <span className="text-xs tracking-widest text-gray-500">BOOTING AUDIOWORKLET...</span>
        </div>
      </div>
    );
  }
  
  const engine = engineRef.current;

  const handlePlayToggle = () => {
    if (snapshot.isPlaying) {
      engine.stop();
      setSnapshot(s => ({ ...s, isPlaying: false }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isPlaying: true }));
    }
  };

  const handleStepToggle = (idx: number) => {
    const s = snapshot.steps[idx];
    const newSteps = [...snapshot.steps];
    newSteps[idx] = { ...s, gate: !s.gate };
    engine.updateStep(idx, { gate: !s.gate });
    setSnapshot(s => ({ ...s, steps: newSteps }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#05111a]/60 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] text-white rounded-xl p-4 font-mono relative overflow-hidden group transition-all">
      <div className="absolute inset-0 bg-gradient-to-l from-cyan-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      {/* HEADER */}
      <div className="relative z-10 flex justify-between items-center mb-4 border-b border-white/10 pb-3">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color }}>DECK {deckId} [TurboFM]</span>
          <span>{snapshot.bpm} BPM</span>
        </div>
        <button onClick={onSwitchToTrack} className="text-gray-400 hover:text-white">[×]</button>
      </div>

      {/* SEQUENCER (32 BAR) */}
      <div className="relative z-10 flex flex-col gap-2 mb-8">
        <div className="flex justify-between gap-1">
          {snapshot.steps.slice(0, 16).map((step, i) => (
            <div 
              key={i} onClick={() => handleStepToggle(i)}
              className={`flex-1 h-6 flex items-center justify-center cursor-pointer transition-all border rounded-sm ${
                snapshot.currentStep === i ? 'border-white scale-110 shadow-[0_0_15px_rgba(255,255,255,0.4)] z-10' : 'border-white/10 hover:bg-white/5'
              }`}
              style={{ backgroundColor: step.gate ? `${color}D0` : 'rgba(0,0,0,0.3)', boxShadow: step.gate ? `0 0 10px ${color}60` : 'none' }}
            />
          ))}
        </div>
        <div className="flex justify-between gap-1">
          {snapshot.steps.slice(16, 32).map((step, i) => (
            <div 
              key={i + 16} onClick={() => handleStepToggle(i + 16)}
              className={`flex-1 h-6 flex items-center justify-center cursor-pointer transition-all border rounded-sm ${
                snapshot.currentStep === i + 16 ? 'border-white scale-110 shadow-[0_0_15px_rgba(255,255,255,0.4)] z-10' : 'border-white/10 hover:bg-white/5'
              }`}
              style={{ backgroundColor: step.gate ? `${color}D0` : 'rgba(0,0,0,0.3)', boxShadow: step.gate ? `0 0 10px ${color}60` : 'none' }}
            />
          ))}
        </div>
      </div>

      {/* BODY - FM MATRIX */}
      <div className="relative z-10 flex flex-1 gap-6 mb-4">
        
        {/* GLOBAL ENVELOPES & ALGO */}
        <div className="flex flex-col gap-4 bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 shadow-inner w-1/4 relative">
          <div className="text-[10px] tracking-widest font-bold text-gray-400 border-b border-white/5 pb-2 flex justify-between items-center">
            GLOBAL
            <button onClick={handleMutateSynth} className="text-[8px] text-[#00e5ff] hover:text-white px-2 py-1 ml-2 border border-[#00e5ff]/30 bg-[#00e5ff]/10 rounded hidden lg:block">DICE</button>
          </div>
          <div className="grid grid-cols-2 gap-3 place-items-center">
            <Knob label="Algo" value={snapshot.synth.algo} onChange={(v: number) => { engine.setSynthParam('algo', v); setSnapshot(s => ({...s, synth: {...s.synth, algo: v}})) }} />
            <Knob label="Feedback" value={snapshot.synth.feedback} onChange={(v: number) => { engine.setSynthParam('feedback', v); setSnapshot(s => ({...s, synth: {...s.synth, feedback: v}})) }} />
            <Knob label="Car Attck" value={snapshot.synth.carAttack} onChange={(v: number) => { engine.setSynthParam('carAttack', v); setSnapshot(s => ({...s, synth: {...s.synth, carAttack: v}})) }} />
            <Knob label="Car Decay" value={snapshot.synth.carDecay} onChange={(v: number) => { engine.setSynthParam('carDecay', v); setSnapshot(s => ({...s, synth: {...s.synth, carDecay: v}})) }} />
            <Knob label="Mod Attck" value={snapshot.synth.modAttack} onChange={(v: number) => { engine.setSynthParam('modAttack', v); setSnapshot(s => ({...s, synth: {...s.synth, modAttack: v}})) }} />
            <Knob label="Mod Decay" value={snapshot.synth.modDecay} onChange={(v: number) => { engine.setSynthParam('modDecay', v); setSnapshot(s => ({...s, synth: {...s.synth, modDecay: v}})) }} />
          </div>
        </div>

        {/* OPERATORS */}
        <div className="flex flex-col gap-3 bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 shadow-inner flex-1">
          <div className="text-[10px] tracking-widest font-bold text-gray-400 border-b border-white/5 pb-2">OPERATOR MATRIX</div>
          <div className="grid grid-cols-4 gap-3 flex-1 place-items-center">
            <div className="flex flex-col gap-3 border-r border-white/5 pr-4 w-full items-center">
              <span className="text-[10px] text-gray-500 font-bold bg-white/10 px-2 py-0.5 rounded">OP1</span>
              <Knob label="Ratio" value={snapshot.synth.op1Ratio} onChange={(v: number) => { engine.setSynthParam('op1Ratio', v); setSnapshot(s => ({...s, synth: {...s.synth, op1Ratio: v}})) }} />
              <Knob label="Level" value={snapshot.synth.op1Level} onChange={(v: number) => { engine.setSynthParam('op1Level', v); setSnapshot(s => ({...s, synth: {...s.synth, op1Level: v}})) }} />
            </div>
            <div className="flex flex-col gap-3 border-r border-white/5 pr-4 w-full items-center">
              <span className="text-[10px] text-gray-500 font-bold bg-white/10 px-2 py-0.5 rounded">OP2</span>
              <Knob label="Ratio" value={snapshot.synth.op2Ratio} onChange={(v: number) => { engine.setSynthParam('op2Ratio', v); setSnapshot(s => ({...s, synth: {...s.synth, op2Ratio: v}})) }} />
              <Knob label="Level" value={snapshot.synth.op2Level} onChange={(v: number) => { engine.setSynthParam('op2Level', v); setSnapshot(s => ({...s, synth: {...s.synth, op2Level: v}})) }} />
            </div>
            <div className="flex flex-col gap-3 border-r border-white/5 pr-4 w-full items-center">
              <span className="text-[10px] text-gray-500 font-bold bg-white/10 px-2 py-0.5 rounded">OP3</span>
              <Knob label="Ratio" value={snapshot.synth.op3Ratio} onChange={(v: number) => { engine.setSynthParam('op3Ratio', v); setSnapshot(s => ({...s, synth: {...s.synth, op3Ratio: v}})) }} />
              <Knob label="Level" value={snapshot.synth.op3Level} onChange={(v: number) => { engine.setSynthParam('op3Level', v); setSnapshot(s => ({...s, synth: {...s.synth, op3Level: v}})) }} />
            </div>
            <div className="flex flex-col gap-3 w-full items-center">
              <span className="text-[10px] text-gray-500 font-bold bg-white/10 px-2 py-0.5 rounded">OP4</span>
              <Knob label="Ratio" value={snapshot.synth.op4Ratio} onChange={(v: number) => { engine.setSynthParam('op4Ratio', v); setSnapshot(s => ({...s, synth: {...s.synth, op4Ratio: v}})) }} />
              <Knob label="Level" value={snapshot.synth.op4Level} onChange={(v: number) => { engine.setSynthParam('op4Level', v); setSnapshot(s => ({...s, synth: {...s.synth, op4Level: v}})) }} />
            </div>
          </div>
        </div>

      </div>

      {/* TRANSPORT */}
      <div className="relative z-10 flex justify-between items-center border-t border-white/10 pt-4 mt-auto">
        <button 
          onClick={handlePlayToggle}
          className="px-8 py-2 rounded-lg font-bold tracking-widest text-sm transition-all shadow-lg border"
          style={{ 
            backgroundColor: snapshot.isPlaying ? `${color}30` : 'transparent',
            borderColor: snapshot.isPlaying ? color : 'rgba(255,255,255,0.2)',
            color: snapshot.isPlaying ? color : '#aaa',
            boxShadow: snapshot.isPlaying ? `0 0 20px ${color}40` : 'none'
          }}
        >
          {snapshot.isPlaying ? 'RUNNING' : 'START'}
        </button>
        
        <div className="flex gap-4 items-center bg-black/40 backdrop-blur rounded-lg p-2 border border-white/5">
          <Knob 
            label="Volume" 
            value={snapshot.masterVolume} 
            onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})) }} 
          />
          <div className="w-[1px] h-6 bg-white/10 mx-1"></div>
          <button onClick={() => engine.clearPattern()} className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/30 rounded text-[10px] hover:bg-red-500/20 transition-colors">CLR</button>
          <button onClick={handleMutateSeq} className="px-3 py-1 bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/30 rounded text-[10px] font-bold hover:bg-[#00e5ff]/20 transition-colors tracking-wider">DICE SEQ</button>
        </div>
      </div>
    </div>
  );
};
