import { useState, useEffect, useRef, FC } from 'react';
import { TurboPulsarEngine, DeckId } from './TurboPulsarEngine';
import { TurboPulsarSnapshot } from './types';

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
      className="w-16 h-1 accent-[#ff00ff]"
    />
  </div>
);

export const TurboPulsarDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboPulsarSnapshot>({
    isActive: false,
    periodMs: 89.33,
    dispersion: 0.5,
    masterVolume: 1.0,
  });

  const [blink, setBlink] = useState(false);
  const engineRef = useRef<TurboPulsarEngine | null>(null);

  useEffect(() => {
    const engine = new TurboPulsarEngine(deckId);
    engine.init(((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext()));
    engineRef.current = engine;

    engine.onPulse = () => {
      setBlink(true);
      // Turn off quickly but allow UI to register it
      setTimeout(() => setBlink(false), Math.min(20, engine.periodMs / 2));
    };

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

  return (
    <div className="flex flex-col h-full w-full bg-[#1a001a] border border-fuchsia-900 text-fuchsia-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(255,0,255,0.1)]">
      <div className="flex justify-between items-center mb-4 border-b border-fuchsia-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#ff00ff' }}>DECK {deckId} [TurboPulsar]</span>
          <span className="text-xs uppercase px-2 bg-fuchsia-900/50 text-fuchsia-200">
            {snapshot.isActive ? 'EMITTING RADIO TRANSIENTS' : 'ORBIT IDLE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-fuchsia-700 hover:text-fuchsia-400">[×]</button>
      </div>

      <div className="flex flex-1 gap-6 p-2">
        <div className="w-1/2 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border ${
               snapshot.isActive 
                 ? 'bg-fuchsia-900/50 border-fuchsia-500 text-fuchsia-200' 
                 : 'bg-transparent border-fuchsia-900 text-fuchsia-700 hover:bg-fuchsia-950'
             }`}
           >
             {snapshot.isActive ? 'HALT ROTATION' : 'ENGAGE NEUTRON STAR'}
           </button>

           <div className="flex flex-col gap-2 p-3 bg-black/50 border border-fuchsia-900/50">
              <span className="text-[10px] text-fuchsia-700">ROTATIONAL PERIOD (Vela = 89.33ms)</span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fuchsia-400">{snapshot.periodMs.toFixed(2)} ms</span>
                {/* Scale from 2ms to 2000ms logarithmically for better UI control */}
                <Knob 
                  label="Rate (Hz)" value={Math.log10(snapshot.periodMs) / 3.3} 
                  onChange={(v: number) => { 
                    const p = Math.pow(10, v * 3.3);
                    engine.periodMs = p; setSnapshot(s => ({...s, periodMs: p}));
                  }} 
                />
              </div>
           </div>

           <div className="flex flex-col gap-2 p-3 bg-black/50 border border-fuchsia-900/50 mt-auto">
              <span className="text-[10px] text-fuchsia-700">DISPERSION MEASURE (ISM)</span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fuchsia-400">DM: {snapshot.dispersion.toFixed(2)}</span>
                <Knob 
                  label="Filter" value={snapshot.dispersion} 
                  onChange={(v: number) => { 
                    engine.dispersion = v; setSnapshot(s => ({...s, dispersion: v}));
                  }} 
                />
              </div>
           </div>
        </div>

        {/* RIGHT: INTERFEROMETER HUD */}
        <div className="flex-1 relative bg-black border-2 border-fuchsia-900 flex items-center justify-center overflow-hidden">
           {/* Grid lines */}
           <div className="absolute w-[80%] h-[80%] border border-fuchsia-900/50 rounded-full" />
           <div className="absolute w-[40%] h-[40%] border border-fuchsia-900/50 rounded-full" />
           <div className="w-[1px] h-full bg-fuchsia-900/50 absolute" />
           <div className="h-[1px] w-full bg-fuchsia-900/50 absolute" />
           
           {/* Pulsating core */}
           <div 
             className={`w-6 h-6 bg-fuchsia-500 rounded-full blur-md transition-opacity duration-75`}
             style={{ 
               opacity: blink && snapshot.isActive ? 1 : 0.2,
               transform: blink && snapshot.isActive ? `scale(${Math.min(3, 300 / snapshot.periodMs)})` : 'scale(1)'
             }}
           />
           <div 
             className="w-2 h-2 bg-white rounded-full z-10 absolute"
             style={{ opacity: blink && snapshot.isActive ? 1 : 0 }}
           />

           {/* Rotational Beam */}
           {snapshot.isActive && (
              <div 
                className="absolute w-1/2 h-[2px] bg-fuchsia-400 left-1/2 origin-left blur-[1px]"
                style={{
                  animation: `spin ${snapshot.periodMs}ms linear infinite`
                }}
              />
           )}
           <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
           
        </div>
      </div>

      <div className="border-t border-fuchsia-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-fuchsia-800">ASTROPHYSICAL EXTRAGALACTIC METRONOME</span>
         <Knob 
           label="Gain" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
