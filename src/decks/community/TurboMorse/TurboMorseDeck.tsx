// @ts-nocheck
import React, { useState, useEffect, useRef, FC } from 'react';
import { TurboMorseEngine, DeckId } from './TurboMorseEngine';
import { TurboMorseSnapshot } from './types';

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
      className="w-16 h-1 accent-[#ffddaa]"
    />
  </div>
);

export const TurboMorseDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboMorseSnapshot>({
    isActive: false,
    message: "MIXI ENIGMA TRANSMISSION",
    wpm: 20,
    distortion: 0.8,
    masterVolume: 1.0,
  });

  const [currentSymbol, setCurrentSymbol] = useState('_');
  const engineRef = useRef<TurboMorseEngine | null>(null);

  useEffect(() => {
    const engine = new TurboMorseEngine(deckId);
    engine.init(new window.AudioContext());
    engineRef.current = engine;

    engine.onTransmit = (sym) => {
       setCurrentSymbol(sym === ' ' ? '_' : sym);
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
    <div className="flex flex-col h-full w-full bg-[#110f08] border border-amber-900 text-amber-600 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(255,200,100,0.1)]">
      
      <div className="flex justify-between items-center mb-4 border-b border-amber-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#ffc155' }}>DECK {deckId} [TurboMorse]</span>
          <span className="text-xs uppercase px-2 bg-amber-900/50 text-amber-200">
            {snapshot.isActive ? 'ENIGMA CIPHER ACTIVE' : 'RADIO SILENCE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-amber-700 hover:text-amber-400">[×]</button>
      </div>

      <div className="flex flex-1 gap-6 p-2">
        <div className="w-1/2 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border outline-none ${
               snapshot.isActive 
                 ? 'bg-amber-900/50 border-amber-500 text-amber-200 shadow-[0_0_15px_#ffaa00]' 
                 : 'bg-transparent border-amber-900 text-amber-700 hover:bg-amber-950'
             }`}
           >
             {snapshot.isActive ? 'INTERRUPT BROADCAST' : 'BROADCAST CIPHER'}
           </button>

           <div className="flex flex-col gap-2 p-3 bg-black/50 border border-amber-900/50">
              <span className="text-[10px] text-amber-700">PAYLOAD STRING</span>
              <input 
                type="text" 
                value={snapshot.message}
                onChange={e => { engine.message = e.target.value; setSnapshot(s => ({...s, message: e.target.value})) }}
                className="w-full bg-black border border-amber-800 text-amber-500 p-1 text-xs outline-none focus:border-amber-500 uppercase"
              />
           </div>

           <div className="flex flex-col gap-4 p-3 bg-black/50 border border-amber-900/50 h-full justify-center">
              <div className="flex justify-between items-center">
                 <span className="text-xs text-amber-600">{snapshot.wpm} WPM</span>
                 <Knob 
                   label="Speed" value={snapshot.wpm / 60} 
                   onChange={(v: number) => { 
                     const w = Math.max(5, Math.floor(v * 60));
                     engine.wpm = w; setSnapshot(s => ({...s, wpm: w}));
                   }} 
                 />
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-xs text-amber-600">SATURATION</span>
                 <Knob 
                   label="Fuzz" value={snapshot.distortion} 
                   onChange={(v: number) => { 
                     engine.distortion = v; setSnapshot(s => ({...s, distortion: v}));
                   }} 
                 />
              </div>
           </div>
        </div>

        {/* RIGHT: TELEGRAPH HUD */}
        <div className="flex-1 relative bg-[#0a0804] border-4 border-amber-900 flex items-center justify-center p-4 overflow-hidden">
           
           <div className="absolute top-2 left-2 text-[10px] text-amber-800">WW2 TELEGRAPH STRIP</div>
           
           <div className="w-full h-16 border-t-2 border-b-2 border-amber-900/50 relative overflow-hidden flex items-center justify-center bg-amber-900/10">
              
              <div 
                className={`text-8xl font-black transition-opacity duration-75 ${
                  currentSymbol !== '_' && snapshot.isActive ? 'text-amber-400 drop-shadow-[0_0_15px_#ff8800]' : 'text-amber-900/30'
                }`}
              >
                 {currentSymbol === '-' ? '━' : currentSymbol === '.' ? '●' : '_'}
              </div>

           </div>
           
        </div>
      </div>

      <div className="border-t border-amber-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-amber-800">CRYPTOGRAPHIC WAVE-SHAPER OVERDRIVE</span>
         <Knob 
           label="Gain" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
