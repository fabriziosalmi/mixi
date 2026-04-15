import { useState, useEffect, useRef, FC } from 'react';
import { TurboGeigerEngine, DeckId } from './TurboGeigerEngine';
import { TurboGeigerSnapshot } from './types';

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
      className="w-16 h-1 accent-[#ff5500]"
    />
  </div>
);

export const TurboGeigerDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboGeigerSnapshot>({
    isPlaying: false,
    halfLife: 0.5,
    radiationType: 'alpha',
    masterVolume: 1.0,
  });

  const [blink, setBlink] = useState(false);
  const [ticks, setTicks] = useState(0); // CPS counter
  const [history, setHistory] = useState<number[]>(Array(20).fill(0));

  const engineRef = useRef<TurboGeigerEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboGeigerEngine(deckId);
    const ctx = ((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext());
    
    let isMounted = true;
    engine.init(ctx).then(() => {
      if (isMounted) {
        engineRef.current = engine;

        // Route audio through mixer channel (EQ, fader, crossfader, master)
        const ch = (window as any).__MIXI_ENGINE__?.getChannel?.(deckId);
        if (ch && engine.bus) engine.bus.output.connect(ch.input);
        engine.onTick = () => {
          setBlink(true);
          setTicks(t => t + 1);
          setHistory(h => [...h.slice(1), 100]);
          setTimeout(() => setBlink(false), 50);
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

  // CPS Counter reset
  useEffect(() => {
    const int = setInterval(() => setTicks(0), 1000);
    return () => clearInterval(int);
  }, []);

  // Decay the visual history
  useEffect(() => {
    if (!snapshot.isPlaying) return;
    const ds = setInterval(() => setHistory(h => h.map(v => Math.max(0, v - Math.random()*20))), 50);
    return () => clearInterval(ds);
  }, [snapshot.isPlaying]);

  if (!isReady) {
    return (
      <div className="flex flex-col h-full w-full bg-[#1a0500] border border-orange-900 text-orange-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(255,85,0,0.1)] items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-t-2 border-b-2" style={{ borderColor: '#ff5500', animation: 'spin 1s linear infinite' }} />
          <span className="text-xs tracking-widest text-orange-600">BOOTING AUDIOWORKLET...</span>
        </div>
      </div>
    );
  }
  
  const engine = engineRef.current!;

  const handleToggle = () => {
    if (snapshot.isPlaying) {
      engine.stop();
      setSnapshot(s => ({ ...s, isPlaying: false }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isPlaying: true }));
    }
  };

  const handleMutate = () => {
    engine.mutate();
    setSnapshot(s => ({ ...s, halfLife: engine.halfLife, radiationType: engine.radiationType }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1a0500]/70 backdrop-blur-md border border-orange-900/50 text-orange-500 rounded-xl p-4 font-mono shadow-[0_8px_32px_rgba(255,85,0,0.15)] relative overflow-hidden group transition-all">
      <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      {/* HEADER */}
      <div className="relative z-10 flex justify-between items-center mb-4 border-b border-orange-900/50 pb-3">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg drop-shadow-[0_0_8px_rgba(255,85,0,0.5)]" style={{ color: color || '#ff5500' }}>DECK {deckId} [TurboGeiger]</span>
          <span className={`text-[10px] tracking-widest uppercase px-3 py-1 rounded-sm shadow-inner transition-colors ${snapshot.isPlaying ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-orange-900/20 text-orange-700 border border-orange-900/30'}`}>
            {snapshot.isPlaying ? 'MÜLLER TUBE ACTIVE' : 'SHIELDED'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleMutate} className="px-3 py-1 border border-orange-500/50 bg-orange-500/10 text-orange-400 rounded-sm font-mono text-[10px] font-bold hover:text-white hover:bg-orange-500/30 hover:shadow-[0_0_10px_rgba(255,85,0,0.5)] transition-all tracking-wider">DICE</button>
          <button onClick={onSwitchToTrack} className="text-orange-700 hover:text-orange-400 transition-colors">[×]</button>
        </div>
      </div>

      {/* BODY */}
      <div className="relative z-10 flex flex-1 gap-8 p-2">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/2 flex flex-col gap-6">
           <button 
             onClick={handleToggle}
             className={`w-full py-3 font-bold tracking-widest text-sm rounded-lg transition-all border shadow-lg ${
               snapshot.isPlaying 
                 ? 'bg-orange-500/20 border-orange-500 text-orange-200 shadow-[0_0_25px_rgba(255,85,0,0.3)]' 
                 : 'bg-transparent border-orange-900/50 text-orange-700 hover:bg-orange-900/20'
             }`}
           >
             {snapshot.isPlaying ? 'DISABLE SENSOR' : 'EXPOSE SENSOR'}
           </button>

           <div className="flex flex-col gap-3 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/5 shadow-inner">
              <span className="text-[10px] tracking-widest font-bold text-orange-500/70 border-b border-orange-900/30 pb-2">STOCHASTIC HALF-LIFE</span>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-orange-300 bg-orange-900/40 px-2 py-1 rounded">{(snapshot.halfLife * 100).toFixed(0)}%</span>
                <Knob 
                  label="Density" value={snapshot.halfLife} 
                  onChange={(v: number) => { 
                    engine.halfLife = v; setSnapshot(s => ({...s, halfLife: v}));
                  }} 
                />
              </div>
           </div>

           <div className="flex flex-col gap-3 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/5 shadow-inner">
              <span className="text-[10px] tracking-widest font-bold text-orange-500/70 border-b border-orange-900/30 pb-2">ISOTOPE CLASSIFICATION</span>
              <div className="flex items-center justify-between gap-2">
                 {['alpha', 'beta', 'gamma'].map(type => (
                   <button 
                     key={type}
                     onClick={() => { const wt = type as 'alpha'|'beta'|'gamma'; engine.radiationType = wt; setSnapshot(s => ({...s, radiationType: wt})) }}
                     className={`flex-1 text-[10px] tracking-widest uppercase py-2 rounded-sm transition-all border ${
                        snapshot.radiationType === type 
                          ? 'bg-orange-500/20 text-orange-200 border-orange-500 shadow-[0_0_15px_rgba(255,85,0,0.3)]' 
                          : 'bg-transparent border-orange-900/30 text-orange-700 hover:bg-orange-900/20'
                        }`}
                   >
                     {type}
                   </button>
                 ))}
              </div>
           </div>
        </div>

        {/* RIGHT: DOSIMETER HUD */}
        <div className="flex-1 relative bg-[#0a0200]/80 rounded-xl border border-orange-500/20 shadow-[inset_0_0_30px_rgba(255,85,0,0.1)] flex flex-col items-center justify-center overflow-hidden p-4">
            
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${blink ? 'bg-white shadow-[0_0_10px_white]' : 'bg-orange-900/50'}`}></div>
              <span className="text-[9px] tracking-widest text-orange-600/80">CPM (COUNTS/SEC)</span>
            </div>
            
            {/* The giant flashing CPM counter */}
            <div className={`text-7xl font-bold font-mono tracking-tighter transition-all duration-75 ${blink ? 'text-white text-shadow-[0_0_20px_white] scale-105' : 'text-orange-500/80 drop-shadow-[0_0_10px_rgba(255,85,0,0.5)]'}`}>
               {snapshot.isPlaying ? (ticks * 60).toString().padStart(4, '0') : '0000'}
            </div>
            
            <div className="w-full mt-6 h-12 flex gap-1 items-end justify-center px-4 relative z-10">
               {/* True probabilistic histogram feed */}
               {history.map((v, i) => (
                 <div 
                   key={i} 
                   className="flex-1 bg-orange-500 rounded-t-sm transition-all duration-75"
                   style={{ 
                     height: snapshot.isPlaying && v > 0 ? `${v}%` : '2%',
                     opacity: v > 0 ? 0.8 : 0.2,
                     boxShadow: snapshot.isPlaying && v > 50 ? '0px -5px 10px rgba(255,85,0,0.5)' : 'none'
                   }}
                 />
               ))}
            </div>

            {/* Radiation hazard symbol SVG background */}
            <svg viewBox="0 0 100 100" className={`absolute w-64 h-64 pointer-events-none fill-orange-500 transition-opacity duration-1000 ${snapshot.isPlaying ? 'opacity-10' : 'opacity-5'}`}>
               <path d="M50 0 C22.4 0 0 22.4 0 50 C0 77.6 22.4 100 50 100 C77.6 100 100 77.6 100 50 C100 22.4 77.6 0 50 0 Z M50 15 C66 15 80 26 83.5 40 L63.5 40 C61.5 32 54 26.5 45 26.5 C36 26.5 28.5 32 26.5 40 L6.5 40 C10 26 24 15 50 15 Z" />
            </svg>
        </div>

      </div>

      {/* FOOTER */}
      <div className="relative z-10 border-t border-orange-900/30 pt-4 mt-auto flex justify-between items-center">
         <div className="flex items-center gap-3">
           <div className={`w-1.5 h-1.5 rounded-full ${snapshot.isPlaying ? 'bg-orange-500 animate-pulse shadow-[0_0_8px_#ff5500]' : 'bg-orange-900/50'}`}></div>
           <span className="text-[9px] tracking-widest text-orange-600/60 uppercase">POISSON DISTRIBUTED GENERATOR ACTIVE</span>
         </div>
         <div className="flex gap-4 bg-black/40 backdrop-blur rounded-lg p-2 border border-orange-900/30">
            <Knob 
              label="Out Vol" value={snapshot.masterVolume} 
              onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
            />
         </div>
      </div>
    </div>
  );
};
