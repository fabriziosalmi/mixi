import { useState, useEffect, useRef, FC } from 'react';
import { TurboBoidEngine, DeckId } from './TurboBoidEngine';
import { TurboBoidSnapshot } from './types';

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
      className="w-16 h-1 accent-[#00ff55]"
    />
  </div>
);

export const TurboBoidDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboBoidSnapshot>({
    isActive: false,
    boidCount: 30,
    maxSpeed: 2.0,
    scale: 1.0,
    masterVolume: 1.0,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TurboBoidEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboBoidEngine(deckId);
    engine.init(((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext()));
    engineRef.current = engine;
    setIsReady(true);

    // Route audio through mixer channel (EQ, fader, crossfader, master)
    const ch = (window as any).__MIXI_ENGINE__?.getChannel?.(deckId);
    if (ch && engine.bus) engine.bus.output.connect(ch.input);

    engine.onBoidsUpdate = (boids, triggers) => {
       const canvas = canvasRef.current;
       if (!canvas) return;
       const ctx = canvas.getContext('2d');
       if (!ctx) return;

       // Use trails
       ctx.fillStyle = 'rgba(0, 5, 0, 0.2)';
       ctx.fillRect(0, 0, canvas.width, canvas.height);

       // Draw grid
       ctx.strokeStyle = 'rgba(0, 255, 85, 0.05)';
       ctx.beginPath();
       for(let i=0; i<canvas.width; i+=20) { ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); }
       for(let i=0; i<canvas.height; i+=20) { ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); }
       ctx.stroke();

       boids.forEach(b => {
         const angle = Math.atan2(b.vy, b.vx);
         ctx.save();
         ctx.translate(b.x, b.y);
         ctx.rotate(angle);
         
         ctx.fillStyle = '#00ff55';
         ctx.beginPath();
         ctx.moveTo(4, 0);
         ctx.lineTo(-4, 3);
         ctx.lineTo(-4, -3);
         ctx.fill();
         ctx.restore();
       });

       triggers.forEach(t => {
         ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
         ctx.beginPath();
         ctx.arc(t.x, t.y, 10, 0, Math.PI*2);
         ctx.fill();
       });
    };

    return () => engine.destroy();
  }, [deckId]);

  if (!isReady) return null;
  const engine = engineRef.current!;

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
    <div className="flex flex-col h-full w-full bg-[#001105] border border-green-900 text-green-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(0,255,85,0.1)]">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-green-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#00ff55' }}>DECK {deckId} [TurboBoid]</span>
          <span className="text-xs uppercase px-2 bg-green-900/50 text-green-200">
            {snapshot.isActive ? 'SWARM ACTIVE' : 'CONTAINED'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-green-700 hover:text-green-400">[×]</button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 gap-6 p-2">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/3 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border ${
               snapshot.isActive 
                 ? 'bg-green-900/50 border-green-500 text-green-200' 
                 : 'bg-transparent border-green-900 text-green-700 hover:bg-green-950'
             }`}
           >
             {snapshot.isActive ? 'RECALL SWARM' : 'RELEASE SWARM'}
           </button>

           <div className="flex flex-col gap-4 p-3 bg-black/50 border border-green-900/50 h-full justify-center">
              <Knob 
                label="Boids" value={snapshot.boidCount / 100} 
                onChange={(v: number) => { 
                  const cnt = Math.max(1, Math.floor(v * 100));
                  engine.boidCount = cnt; setSnapshot(s => ({...s, boidCount: cnt}));
                }} 
              />
              <Knob 
                label="Velocity" value={snapshot.maxSpeed / 10} 
                onChange={(v: number) => { 
                  const spd = v * 10;
                  engine.maxSpeed = spd; setSnapshot(s => ({...s, maxSpeed: spd}));
                }} 
              />
           </div>
        </div>

        {/* RIGHT: A-LIFE HUD */}
        <div className="flex-1 relative bg-black border-2 border-green-800 p-2 flex">
           <canvas 
             ref={canvasRef} 
             width={400} 
             height={200}
             className="w-full h-full object-contain mix-blend-screen bg-black"
           />
           {!snapshot.isActive && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-green-800 opacity-50">
               SYSTEM HALTED
             </div>
           )}
        </div>

      </div>

      {/* FOOTER */}
      <div className="border-t border-green-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-green-700">FLOCKING ALGORITHM COLLISION GATE</span>
         <Knob 
           label="Out Vol" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
