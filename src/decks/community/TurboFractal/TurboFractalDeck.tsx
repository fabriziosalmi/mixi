import { useState, useEffect, useRef, FC } from 'react';
import { TurboFractalEngine, DeckId } from './TurboFractalEngine';
import { TurboFractalSnapshot } from './types';

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
      className="w-16 h-1 accent-[#7700ff]"
    />
  </div>
);

export const TurboFractalDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboFractalSnapshot>({
    isActive: false,
    baseFreq: 55,
    posX: -0.7,
    posY: 0.0,
    zoom: 1.0,
    masterVolume: 1.0,
  });

  const [fractalDat, setFractalDat] = useState({ iters: 0, escape: false });
  const engineRef = useRef<TurboFractalEngine | null>(null);

  useEffect(() => {
    const engine = new TurboFractalEngine(deckId);
    engine.init(new window.AudioContext());
    engineRef.current = engine;

    engine.onFractalUpdate = (iters, escape) => {
      setFractalDat({ iters, escape });
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
    <div className="flex flex-col h-full w-full bg-[#050011] border border-violet-900 text-violet-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(119,0,255,0.1)]">
      
      <div className="flex justify-between items-center mb-4 border-b border-violet-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#7700ff' }}>DECK {deckId} [TurboFractal]</span>
          <span className="text-xs uppercase px-2 bg-violet-900/50 text-violet-200">
            {snapshot.isActive ? 'ITERATING COMPLEX PLANE' : 'HALTED'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-violet-700 hover:text-violet-400">[×]</button>
      </div>

      <div className="flex flex-1 gap-6 p-2">
        <div className="w-1/2 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border outline-none ${
               snapshot.isActive 
                 ? 'bg-violet-900/50 border-violet-500 text-violet-200 shadow-[0_0_15px_#7700ff]' 
                 : 'bg-transparent border-violet-900 text-violet-700 hover:bg-violet-950'
             }`}
           >
             {snapshot.isActive ? 'ABORT CALCULATION' : 'EVALUATE MANDELBROT'}
           </button>

           <div className="flex flex-col gap-4 p-3 bg-black/50 border border-violet-900/50 justify-center h-full">
              <div className="flex justify-between items-center">
                 <span className="text-xs text-violet-600">Re(C) X:</span>
                 <Knob 
                   label="Real" value={(snapshot.posX + 2) / 3} // Map -2 to 1 => 0 to 1
                   onChange={(v: number) => { 
                     const x = (v * 3) - 2;
                     engine.posX = x; setSnapshot(s => ({...s, posX: x}));
                   }} 
                 />
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-xs text-violet-600">Im(C) Y:</span>
                 <Knob 
                   label="Imag" value={(snapshot.posY + 1) / 2} // Map -1 to 1 => 0 to 1
                   onChange={(v: number) => { 
                     const y = (v * 2) - 1;
                     engine.posY = y; setSnapshot(s => ({...s, posY: y}));
                   }} 
                 />
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-xs text-violet-600">Drone Freq</span>
                 <Knob 
                   label="Hz" value={Math.log2(snapshot.baseFreq / 27.5) / 5} 
                   onChange={(v: number) => { 
                     // octaves from A0 (27.5)
                     const hz = 27.5 * Math.pow(2, v * 5);
                     engine.baseFreq = hz; setSnapshot(s => ({...s, baseFreq: hz}));
                   }} 
                 />
              </div>
           </div>
        </div>

        {/* RIGHT: FRACTAL STATE HUD */}
        <div className="flex-1 relative bg-black border-2 border-violet-900 flex flex-col items-center justify-center p-2 overflow-hidden">
           <span className="absolute top-2 left-2 text-[10px] text-violet-800">HARMONIC SET Z(n)</span>
           
           <div className="w-full flex-1 flex items-end justify-center gap-1 mt-6">
              {/* Direct deterministic mapping to the escape velocity equation */}
              {Array.from({length: 32}).map((_, i) => {
                 let active = snapshot.isActive && i < fractalDat.iters;
                 // As the index increases, we map it to expected harmonic strength dropoff
                 // ensuring larger iterations maintain deterministic geometry.
                 return (
                   <div 
                     key={i} 
                     className="flex-1 bg-violet-600 transition-all duration-75"
                     style={{
                       height: active ? `${20 + (1 - (i/(fractalDat.iters||1))) * 80}%` : '5%',
                       opacity: active ? 1 - (i/32) : 0.2
                     }}
                   />
                 )
              })}
           </div>

           <div className="w-full mt-2 text-center text-xs text-violet-400">
             {snapshot.isActive ? (
               fractalDat.escape ? `ESCAPED AT N=${fractalDat.iters}` : 'STABLE ORBIT (INFINITY)'
             ) : 'AWAITING FUNCTION'}
           </div>
        </div>
      </div>

      <div className="border-t border-violet-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-violet-800">ADDITIVE GEOMETRIC SPECTRAL SHAPER</span>
         <Knob 
           label="Gain" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
