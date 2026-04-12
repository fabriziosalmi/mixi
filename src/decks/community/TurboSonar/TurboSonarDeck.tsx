import { useState, useEffect, useRef, FC } from 'react';
import { TurboSonarEngine, DeckId } from './TurboSonarEngine';
import { TurboSonarSnapshot } from './types';

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
      className="w-16 h-1 accent-[#00ff88]"
    />
  </div>
);

export const TurboSonarDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboSonarSnapshot>({
    isActive: false,
    depth: 0.8,
    pingRate: 0.1, 
    masterVolume: 1.0,
  });

  const [pings, setPings] = useState<{id: number, angle: number, opacity: number}[]>([]);
  const engineRef = useRef<TurboSonarEngine | null>(null);

  useEffect(() => {
    const engine = new TurboSonarEngine(deckId);
    engine.init(((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext()));
    engineRef.current = engine;

    let pingId = 0;
    engine.onPing = (angle) => {
       const id = pingId++;
       setPings(prev => [...prev, { id, angle, opacity: 1.0 }]);
    };

    return () => engine.destroy();
  }, [deckId]);

  // Decay loop for radar pings
  useEffect(() => {
    if (!snapshot.isActive) {
      setPings([]);
      return;
    }
    const int = setInterval(() => {
      setPings(prev => prev.map(p => ({...p, opacity: p.opacity - 0.05})).filter(p => p.opacity > 0));
    }, 100);
    return () => clearInterval(int);
  }, [snapshot.isActive]);

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
    <div className="flex flex-col h-full w-full bg-[#000502] border border-emerald-900 text-emerald-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(0,255,136,0.1)]">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-emerald-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#00ff88' }}>DECK {deckId} [TurboSonar]</span>
          <span className="text-xs uppercase px-2 bg-emerald-900/50 text-emerald-200">
            {snapshot.isActive ? 'ABYSS SCANNING' : 'SYSTEM IDLE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-emerald-700 hover:text-emerald-400">[×]</button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 gap-6 p-2">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/3 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border ${
               snapshot.isActive 
                 ? 'bg-emerald-900/50 border-emerald-500 text-emerald-200 shadow-[0_0_15px_#00ff88]' 
                 : 'bg-transparent border-emerald-900 text-emerald-700 hover:bg-emerald-950'
             }`}
           >
             {snapshot.isActive ? 'POWER DOWN' : 'INITIATE PING'}
           </button>

           <div className="flex flex-col gap-4 p-3 bg-black/50 border border-emerald-900/50 h-full justify-center">
              <Knob 
                label="Abyss Depth" value={snapshot.depth} 
                onChange={(v: number) => { 
                  engine.depth = v; setSnapshot(s => ({...s, depth: v}));
                }} 
              />
              <Knob 
                label="Ping Freq" value={snapshot.pingRate * 2} // 0 to 0.5Hz max
                onChange={(v: number) => { 
                  let hz = Math.max(0.01, v / 2);
                  engine.pingRate = hz; setSnapshot(s => ({...s, pingRate: hz}));
                }} 
              />
           </div>
        </div>

        {/* RIGHT: RADAR HUD */}
        <div className="flex-1 relative bg-[#001108] border-2 border-emerald-900 p-2 flex items-center justify-center overflow-hidden">
           
           {/* Radar Grid */}
           <div className="absolute w-[90%] pt-[90%] rounded-full border border-emerald-900" />
           <div className="absolute w-[60%] pt-[60%] rounded-full border border-emerald-800" />
           <div className="absolute w-[30%] pt-[30%] rounded-full border border-emerald-700" />
           <div className="absolute w-full h-[1px] bg-emerald-900" />
           <div className="absolute h-full w-[1px] bg-emerald-900" />

           {/* Radar Sweeper */}
           {snapshot.isActive && (
              <div 
                className="absolute w-1/2 h-1/2 left-1/2 bottom-1/2 origin-bottom-left"
                style={{ 
                  background: 'linear-gradient(to right, rgba(0,255,136,0) 0%, rgba(0,255,136,0.3) 100%)',
                  borderRight: '2px solid #00ff88',
                  animation: 'radar-sweep 4s linear infinite',
                }}
              />
           )}
           <style>{`@keyframes radar-sweep { 100% { transform: rotate(360deg); } }`}</style>
           
           {/* Blipping Pings */}
           {pings.map(p => (
             <div 
               key={p.id}
               className="absolute w-3 h-3 bg-white rounded-full shadow-[0_0_10px_#00ff88]"
               style={{
                 opacity: p.opacity,
                 transform: `rotate(${p.angle}deg) translateY(-80px)`,
                 transformOrigin: '50% 80px',
               }}
             />
           ))}
           
           {!snapshot.isActive && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-emerald-800 opacity-50 bg-black/80">
               TRANSDUCER OFFLINE
             </div>
           )}
        </div>

      </div>

      {/* FOOTER */}
      <div className="border-t border-emerald-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-emerald-700">HYDROACOUSTIC TRANSDUCER & CONVOLVER</span>
         <Knob 
           label="Gain" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
