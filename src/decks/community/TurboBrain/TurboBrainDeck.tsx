import { useState, useEffect, useRef, FC } from 'react';
import { TurboBrainEngine, DeckId } from './TurboBrainEngine';
import { TurboBrainSnapshot } from './types';

export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

export interface KnobProps { value: number; label: string; onChange: (v: number) => void; size?: string; }
const Knob: FC<KnobProps> = ({ value, label, onChange }) => (
  <div className="flex flex-col items-center">
    <span className="text-[10px] text-gray-400 font-mono truncate max-w-[60px]">{label}</span>
    <input 
      type="range" min="0" max="1" step="0.01" 
      value={value} onChange={e => onChange(parseFloat(e.target.value))} 
      className="w-16 h-1 accent-[#00f0ff]"
    />
  </div>
);

export const TurboBrainDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboBrainSnapshot>({
    isActive: false,
    baseFreq: 200,
    beatFreq: 7, 
    waveType: 'sine',
    masterVolume: 1.0,
  });

  const engineRef = useRef<TurboBrainEngine | null>(null);

  useEffect(() => {
    const engine = new TurboBrainEngine(deckId);
    engine.init(((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext()));
    engineRef.current = engine;

    // Route audio through mixer channel (EQ, fader, crossfader, master)
    const ch = (window as any).__MIXI_ENGINE__?.getChannel?.(deckId);
    if (ch && engine.bus) engine.bus.output.connect(ch.input);
    return () => engine.destroy();
  }, [deckId]);

  if (!engineRef.current) return null;
  const engine = engineRef.current;

  const handleToggle = () => {
    if (snapshot.isActive) {
      engine.stop();
      setSnapshot(s => ({ ...s, isActive: false }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isActive: true }));
    }
  };

  const getBrainwaveState = (freq: number) => {
    if (freq < 4) return 'DELTA (Deep Sleep)';
    if (freq < 8) return 'THETA (Meditation)';
    if (freq < 14) return 'ALPHA (Relaxation)';
    if (freq < 30) return 'BETA (Focus)';
    return 'GAMMA (High Cognition)';
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#051111] border border-cyan-900 text-cyan-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(0,255,255,0.1)]">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-cyan-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#00f0ff' }}>DECK {deckId} [TurboBrain]</span>
          <span className="text-xs uppercase px-2 border border-cyan-700">
            {snapshot.isActive ? 'INDUCING' : 'IDLE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-cyan-700 hover:text-cyan-400">[×]</button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 gap-6 p-2">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/2 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border ${
               snapshot.isActive 
                 ? 'bg-cyan-900/50 border-cyan-500 text-cyan-200' 
                 : 'bg-transparent border-cyan-900 text-cyan-700 hover:bg-cyan-950'
             }`}
           >
             {snapshot.isActive ? 'ABORT ENTRAINMENT' : 'INIT ENTRAINMENT'}
           </button>

           <div className="flex flex-col gap-2 p-3 bg-black/50 border border-cyan-900/50">
              <span className="text-[10px] text-cyan-700">CARRIER MULTIPLIER</span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-600">{snapshot.baseFreq.toFixed(1)} Hz</span>
                <Knob 
                  label="Tone" value={(snapshot.baseFreq - 50) / 450} 
                  onChange={(v: number) => { 
                    const freq = 50 + v * 450; 
                    engine.baseFreq = freq; setSnapshot(s => ({...s, baseFreq: freq}));
                  }} 
                />
              </div>
           </div>

           <div className="flex flex-col gap-2 p-3 bg-black/50 border border-cyan-900/50">
              <span className="text-[10px] text-cyan-700">BINAURAL OFFSET</span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-600 font-bold">{snapshot.beatFreq.toFixed(2)} Hz</span>
                <Knob 
                  label="Beats" value={snapshot.beatFreq / 40} 
                  onChange={(v: number) => { 
                    const freq = 0.5 + v * 39.5; 
                    engine.beatFreq = freq; setSnapshot(s => ({...s, beatFreq: freq}));
                  }} 
                />
              </div>
              <div className="text-center text-[10px] mt-1 text-cyan-400 font-bold animate-pulse">
                {getBrainwaveState(snapshot.beatFreq)}
              </div>
           </div>
        </div>

        {/* RIGHT: OSCILLOSCOPE HUD */}
        <div className="flex-1 relative bg-[#001a1a] border border-cyan-800 flex items-center justify-center overflow-hidden p-2">
            <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.8)_50%)] bg-[length:100%_4px]" />
            <div className="absolute top-2 left-2 text-[10px] text-cyan-700 z-10">L/R INTERFERENCE PATTERN</div>
            
            {/* Extremely simple visualizer matching the beat frequency */}
            <div className="w-full h-full flex items-center justify-center relative">
              {snapshot.isActive ? (
                <>
                  <div className="absolute w-32 h-32 border-2 border-cyan-500 rounded-full opacity-30 mix-blend-screen" />
                  <div 
                    className="absolute w-32 h-32 border-2 border-fuchsia-500 rounded-full opacity-30 mix-blend-screen"
                    style={{ 
                      transform: 'scale(1.05)',
                      animation: `ping ${1 / snapshot.beatFreq}s cubic-bezier(0, 0, 0.2, 1) infinite` 
                    }}
                  />
                  <div className="w-4 h-4 bg-white rounded-full z-20 shadow-[0_0_15px_#00ffff]" />
                </>
              ) : (
                <div className="w-full h-[1px] bg-cyan-900" />
              )}
            </div>
            <style>{`
              @keyframes ping {
                75%, 100% { transform: scale(1.5); opacity: 0; }
              }
            `}</style>
        </div>

      </div>

      {/* FOOTER */}
      <div className="border-t border-cyan-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-cyan-800">WARNING: REQUIRES STEREO HEADPHONES</span>
         <div className="flex gap-4">
            <button 
              onClick={() => { const wt = snapshot.waveType === 'sine' ? 'triangle' : 'sine'; engine.waveType = wt; setSnapshot(s => ({...s, waveType: wt})) }}
              className="px-3 py-1 bg-cyan-900/30 text-[10px] border border-cyan-800 uppercase"
            >
              {snapshot.waveType}
            </button>
            <Knob 
              label="Vol" value={snapshot.masterVolume} 
              onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
            />
         </div>
      </div>
    </div>
  );
};
