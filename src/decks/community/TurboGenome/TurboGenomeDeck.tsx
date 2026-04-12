import { useState, useEffect, useRef, FC } from 'react';
import { TurboGenomeEngine, DeckId } from './TurboGenomeEngine';
import { TurboGenomeSnapshot } from './types';

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
      className="w-16 h-1 accent-[#ff3366]"
    />
  </div>
);

export const TurboGenomeDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboGenomeSnapshot>({
    isActive: false,
    sequenceStr: '',
    speedMs: 150,
    mutationRate: 0.05,
    masterVolume: 1.0,
  });

  const [cursor, setCursor] = useState({ index: 0, char: '', mut: false });
  const engineRef = useRef<TurboGenomeEngine | null>(null);

  useEffect(() => {
    const engine = new TurboGenomeEngine(deckId);
    engine.init(new window.AudioContext());
    engineRef.current = engine;
    
    setSnapshot(s => ({ ...s, sequenceStr: engine.baseSequence }));

    engine.onNucleotideRead = (char, index, mut) => {
      setCursor({ index, char, mut });
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

  const currentSeq = snapshot.sequenceStr;

  return (
    <div className="flex flex-col h-full w-full bg-[#1a050f] border border-rose-900 text-rose-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(255,51,102,0.1)]">
      
      <div className="flex justify-between items-center mb-4 border-b border-rose-900 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#ff3366' }}>DECK {deckId} [TurboGenome]</span>
          <span className="text-xs uppercase px-2 bg-rose-900/50 text-rose-200">
            {snapshot.isActive ? 'SEQUENCING' : 'IDLE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-rose-700 hover:text-rose-400">[×]</button>
      </div>

      <div className="flex flex-1 gap-6 p-2">
        <div className="w-1/3 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border outline-none ${
               snapshot.isActive 
                 ? 'bg-rose-900/50 border-rose-500 text-rose-200' 
                 : 'bg-transparent border-rose-900 text-rose-700 hover:bg-rose-950'
             }`}
           >
             {snapshot.isActive ? 'HALT SEQUENCE' : 'EXTRACT DNA'}
           </button>

           <div className="flex flex-col gap-4 p-3 bg-black/50 border border-rose-900/50 h-full justify-center">
              <Knob 
                label="BPS (Hz)" value={1.0 - (snapshot.speedMs / 1000)} 
                onChange={(v: number) => { 
                  const ms = Math.max(50, (1.0 - v) * 1000);
                  engine.speedMs = ms; setSnapshot(s => ({...s, speedMs: ms}));
                }} 
              />
              <Knob 
                label="Mutagen" value={snapshot.mutationRate * 5} // 0 to 0.20
                onChange={(v: number) => { 
                  let rate = v / 5;
                  engine.mutationRate = rate; setSnapshot(s => ({...s, mutationRate: rate}));
                }} 
              />
           </div>
        </div>

        {/* RIGHT: SEQUENCE STREAM */}
        <div className="flex-1 relative bg-black border border-rose-900 flex items-center justify-center overflow-hidden p-4">
           {/* Display the characters wrapped, highlight current */}
           <div className="w-full text-left break-all leading-relaxed text-sm tracking-[0.2em]">
              {Array.from(currentSeq).map((char, i) => {
                 const isCur = snapshot.isActive && cursor.index === i;
                 return (
                   <span 
                     key={i} 
                     className={`transition-colors duration-75 ${
                       isCur && cursor.mut ? 'bg-white text-black font-bold scale-125 inline-block' 
                       : isCur ? 'bg-rose-500 text-white font-bold scale-110 inline-block shadow-[0_0_10px_#ff3366]' 
                       : 'text-rose-900 opacity-60'
                     }`}
                   >
                     {isCur ? cursor.char : char}
                   </span>
                 )
              })}
           </div>

           {!snapshot.isActive && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-rose-800 opacity-50 bg-black/80">
               NUCLEOBASES OFFLINE
             </div>
           )}
        </div>
      </div>

      <div className="border-t border-rose-900/50 pt-3 flex justify-between items-center">
         <span className="text-[10px] text-rose-800">MARKOV CHAIN CHROMOSOMAL ARPEGGIATOR</span>
         <Knob 
           label="Gain" value={snapshot.masterVolume} 
           onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})); }} 
         />
      </div>
    </div>
  );
};
