import { useState, useEffect, useRef, FC } from 'react';
import { TurboCamEngine, DeckId } from './TurboCamEngine';
import { TurboCamSnapshot } from './types';

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
      className="w-16 h-1 accent-[#ffdd00]"
    />
  </div>
);

export const TurboCamDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboCamSnapshot>({
    isActive: false,
    camWidth: 0,
    camHeight: 0,
    threshold: 30, // Default internally
    smoothing: 0.8,
    masterVolume: 1.0,
  });

  const [motion, setMotion] = useState({ x: 0.5, y: 0.5 });
  const engineRef = useRef<TurboCamEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const engine = new TurboCamEngine(deckId);
    engine.init(new window.AudioContext());
    engineRef.current = engine;

    engine.onMotionUpdate = (x, y) => {
      setMotion({ x, y });
      // Example integration: Dispatching custom event to window so Mixi can hook it!
      window.dispatchEvent(new CustomEvent('TurboCamMotion', { detail: { deckId, x, y } }));
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
      if (videoRef.current) {
        engine.engage(videoRef.current);
        setSnapshot(s => ({ ...s, isActive: true }));
      }
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#111100] border border-yellow-900 text-yellow-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(255,200,0,0.1)] relative">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-yellow-900 pb-2 z-10">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#ffdd00' }}>DECK {deckId} [TurboCam]</span>
          <span className="text-xs uppercase px-2 border border-yellow-700 animate-pulse">
            {snapshot.isActive ? 'OPTICAL_TRACKING' : 'OFFLINE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-yellow-700 hover:text-yellow-400">[×]</button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 gap-6 p-2 h-[200px]">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/3 flex flex-col gap-4 justify-center bg-black/50 p-4 border border-yellow-900/50">
           <button 
             onClick={handleToggle}
             className="w-full bg-yellow-900/30 hover:bg-yellow-800 border border-yellow-500 text-yellow-300 py-2 font-bold mb-4"
           >
             {snapshot.isActive ? 'DEACTIVATE_CAM' : 'INITIALIZE_CAM'}
           </button>

           <div className="flex gap-4">
              <Knob 
                label="Sensitivity" 
                value={1.0 - (snapshot.threshold / 100)} // Invert for UI
                onChange={(v: number) => { 
                  let th = 100 - (v * 100);
                  engine.threshold = th; 
                  setSnapshot(s => ({...s, threshold: th}));
                }} 
              />
              <Knob 
                label="Smoothing" 
                value={snapshot.smoothing} 
                onChange={(v: number) => { engine.smoothing = v; setSnapshot(s => ({...s, smoothing: v})) }} 
              />
           </div>
           
           <div className="mt-4 border-t border-yellow-900/50 pt-2 text-center text-[10px] text-yellow-700">
             X: {motion.x.toFixed(2)} | Y: {motion.y.toFixed(2)}
           </div>
        </div>

        {/* RIGHT: VIDEO FEED HUD */}
        <div className="flex-1 relative bg-black/80 border border-yellow-900 overflow-hidden flex items-center justify-center">
           {/* The actual video feed */}
           <video 
             ref={videoRef} 
             autoPlay playsInline muted 
             className={`w-full h-full object-cover grayscale sepia hue-rotate-[-30deg] opacity-60 mix-blend-screen scale-x-[-1] transition-opacity ${snapshot.isActive ? 'opacity-80' : 'opacity-0'}`}
           />
           
           {!snapshot.isActive && (
             <div className="absolute inset-0 flex items-center justify-center text-xs text-yellow-800">
                NO SIGNAL
             </div>
           )}

           {/* HUD CROSSHAIR */}
           {snapshot.isActive && (
             <div 
               className="absolute w-12 h-12 pointer-events-none transition-all duration-75 ease-linear"
               style={{
                 left: `calc(${motion.x * 100}% - 24px)`,
                 top: `calc(${motion.y * 100}% - 24px)`,
               }}
             >
               <div className="w-full h-full border border-yellow-500 rounded-full animate-[spin_4s_linear_infinite]" />
               <div className="absolute top-1/2 left-0 w-full h-[1px] bg-yellow-500" />
               <div className="absolute left-1/2 top-0 w-[1px] h-full bg-yellow-500" />
             </div>
           )}
        </div>
      </div>

      {/* FOOTER */}
      <div className="border-t border-yellow-900/50 pt-2 flex justify-between">
         <span className="text-[10px] text-yellow-800">API: window.addEventListener('TurboCamMotion')</span>
         <span className="text-[10px] text-yellow-800">C_O_M OPTICAL FLOW</span>
      </div>

    </div>
  );
};
