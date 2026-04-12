import { useState, useEffect, useRef, FC } from 'react';
import { TurboFireEngine, DeckId } from './TurboFireEngine';
import { TurboFireSnapshot, defaultSynth, defaultFx } from './types';

export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

export interface KnobProps { value: number; label: string; onChange: (v: number) => void; size?: string; }
const Knob: FC<KnobProps> = ({ value, label, onChange }) => (
  <div className="flex flex-col items-center">
    <span className="text-[10px] text-gray-400 font-mono truncate max-w-[60px] mb-1">{label}</span>
    <input 
      type="range" min="0" max="1" step="0.01" 
      value={value} onChange={e => onChange(parseFloat(e.target.value))} 
      className="w-16 h-2 accent-[#ff6600]"
    />
  </div>
);

export const TurboFireDeck: FC<HouseDeckProps> = ({ deckId, color: _color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboFireSnapshot>({
    isPlaying: false,
    masterVolume: 1.0,
    synth: defaultSynth(),
    fx: defaultFx(),
  });

  const engineRef = useRef<TurboFireEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboFireEngine(deckId);
    const ctx = new window.AudioContext();
    
    let isMounted = true;
    engine.init(ctx).then(() => {
      if (isMounted) {
        engineRef.current = engine;
        setIsReady(true);
      }
    });
    
    return () => {
      isMounted = false;
      engine.destroy();
      ctx.close();
    };
  }, [deckId]);

  if (!isReady || !engineRef.current) {
    return (
      <div className="flex flex-col h-full w-full bg-black/80 text-white rounded-lg p-4 font-mono items-center justify-center border border-[#ff6600]/30 shadow-[0_0_30px_rgb(255,100,0,0.1)]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-t-2 border-b-2" style={{ borderColor: '#ff6600', animation: 'spin 1s linear infinite' }} />
          <span className="text-xs tracking-widest text-[#ffbb00]">BOOTING AUDIOWORKLET...</span>
        </div>
      </div>
    );
  }
  
  const engine = engineRef.current;

  const handleMutateSynth = () => {
    engine.mutateParams();
    setSnapshot(s => ({ ...s, synth: { ...engine.synthParams } }));
  };

  const handlePlayToggle = () => {
    if (snapshot.isPlaying) {
      engine.stop();
      setSnapshot(s => ({ ...s, isPlaying: false }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isPlaying: true }));
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-black/80 text-white rounded-lg font-mono relative overflow-hidden border border-[#ff6600]/30 shadow-[0_0_30px_rgb(255,100,0,0.1)]">
      
      {/* BACKGROUND VIDEO / GIF PLACEHOLDER */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none mix-blend-screen flex items-center justify-center">
         {/* Placeholder Art - User will replace this with pure art */}
         <img 
            src="https://media.giphy.com/media/26FPCXdkvDbKBbgOI/giphy.gif" 
            alt="Virtual Fireplace Art" 
            className="w-full h-full object-cover blur-sm"
         />
         {/* Dynamic Brightness Overlay based on warmth */}
         <div 
           className="absolute inset-0 bg-[#ff6600]" 
           style={{ opacity: snapshot.synth.warmth * 0.5, mixBlendMode: 'overlay' }}
         />
      </div>

      <div className="relative z-10 flex flex-col h-full p-4">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6 border-b border-[#ff6600]/30 pb-2">
          <div className="flex items-center gap-4">
            <span className="font-bold text-lg text-[#ffbb00]">DECK {deckId} [TurboFire]</span>
            <span className="text-gray-400 text-xs tracking-widest">ATMOSPHERIC ASMR GENERATOR</span>
          </div>
          <button onClick={onSwitchToTrack} className="text-gray-400 hover:text-white">[×]</button>
        </div>

        {/* BODY - EXPERIMENTAL NOISE CONTROLS */}
        <div className="relative z-10 flex flex-col flex-1 justify-center items-center gap-8 mb-6 mt-8">
          <div className="flex gap-8 bg-black/40 backdrop-blur-xl p-8 rounded-3xl border border-[#ff6600]/30 shadow-[0_0_30px_rgba(255,102,0,0.15)] group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-[#ff6600]/5 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
            <Knob 
              label="WARMTH" 
              value={snapshot.synth.warmth} 
              onChange={(v: number) => { engine.setSynthParam('warmth', v); setSnapshot(s => ({...s, synth: {...s.synth, warmth: v}})) }} 
            />
            <Knob 
              label="CRACKLE" 
              value={snapshot.synth.crackle} 
              onChange={(v: number) => { engine.setSynthParam('crackle', v); setSnapshot(s => ({...s, synth: {...s.synth, crackle: v}})) }} 
            />
            <Knob 
              label="WIND" 
              value={snapshot.synth.wind} 
              onChange={(v: number) => { engine.setSynthParam('wind', v); setSnapshot(s => ({...s, synth: {...s.synth, wind: v}})) }} 
            />
          </div>
        </div>

        {/* TRANSPORT */}
        <div className="relative z-10 flex justify-between items-center border-t border-[#ff6600]/30 pt-4 bg-black/40 backdrop-blur-md p-3 rounded-xl shadow-inner">
          <button 
            onClick={handlePlayToggle}
            className="px-8 py-3 border-2 rounded font-bold tracking-widest"
            style={{ 
              borderColor: snapshot.isPlaying ? '#ff6600' : 'gray', 
              color: snapshot.isPlaying ? '#ffeedd' : 'white',
              backgroundColor: snapshot.isPlaying ? 'rgba(255,100,0,0.2)' : 'transparent',
              boxShadow: snapshot.isPlaying ? '0 0 20px rgba(255,100,0,0.4)' : 'none'
            }}
          >
            {snapshot.isPlaying ? 'IGNITED' : 'IGNITE'}
          </button>
          
          <div className="flex gap-4 items-center bg-black/50 p-2 rounded-lg border border-white/5">
            <Knob 
              label="Volume" 
              value={snapshot.masterVolume} 
              onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})) }} 
            />
            <div className="w-[1px] h-6 bg-white/10 mx-1"></div>
            <button onClick={handleMutateSynth} className="px-3 py-1 bg-[#ff6600]/10 border border-[#ff6600]/30 text-[#ff6600] rounded font-mono text-[10px] font-bold hover:bg-[#ff6600]/20 transition tracking-wider">DICE ENV</button>
          </div>
        </div>
      </div>
    </div>
  );
};
