import { useState, useEffect, useRef, FC } from 'react';
import { TurboNewsEngine, DeckId } from './TurboNewsEngine';
import { TurboNewsSnapshot } from './types';

export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

const PRESETS = [
  { name: 'HackerNews', url: 'https://news.ycombinator.com/rss' },
  { name: 'Resident Advisor', url: 'https://ra.co/xml/news.xml' },
  { name: 'BBC Tech', url: 'http://feeds.bbci.co.uk/news/technology/rss.xml' },
];

export const TurboNewsDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboNewsSnapshot>({
    status: 'idle',
    feedUrl: '',
    headlines: [],
    currentIndex: 0,
    masterVolume: 1.0,
  });

  const [inputUrl, setInputUrl] = useState('');
  const engineRef = useRef<TurboNewsEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboNewsEngine(deckId);
    engine.init(((window as any).__MIXI_ENGINE__?.getAudioContext?.() ?? new AudioContext()));
    engineRef.current = engine;
    setIsReady(true);

    // Route audio through mixer channel (EQ, fader, crossfader, master)
    const ch = (window as any).__MIXI_ENGINE__?.getChannel?.(deckId);
    if (ch && engine.bus) engine.bus.output.connect(ch.input);

    engine.onStatusChange = (status, err) => {
      setSnapshot(s => ({ ...s, status, errorMessage: err }));
    };

    engine.onHeadlinesLoaded = (headlines) => {
      setSnapshot(s => ({ ...s, headlines, currentIndex: 0 }));
    };

    return () => engine.destroy();
  }, [deckId]);

  // Cypher Text Marquee Logic
  useEffect(() => {
    if (snapshot.status !== 'playing' || snapshot.headlines.length === 0) return;
    
    // Cycle every 10 seconds
    const timer = setInterval(() => {
      setSnapshot(s => ({
        ...s,
        currentIndex: (s.currentIndex + 1) % s.headlines.length
      }));
    }, 8000);
    
    return () => clearInterval(timer);
  }, [snapshot.status, snapshot.headlines.length]);

  if (!isReady) return null;
  const engine = engineRef.current!;

  const handleFetch = (url: string) => {
    setInputUrl(url);
    engine.loadFeed(url);
  };

  const handleStop = () => {
    engine.stop();
    setSnapshot(s => ({ ...s, headlines: [], currentIndex: 0 }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0c] border border-green-900/50 text-green-500 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(0,255,0,0.1)] relative overflow-hidden">
      
      {/* SCANLINES OVERLAY */}
      <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.5)_50%)] bg-[length:100%_4px] z-20" />

      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-green-900/50 pb-2 relative z-10">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#00ffcc' }}>DECK {deckId} [TurboNews]</span>
          <span className="text-xs tracking-widest uppercase border border-green-700 px-2 animate-pulse">{snapshot.status}</span>
        </div>
        <button onClick={onSwitchToTrack} className="text-green-700 hover:text-green-400">[×]</button>
      </div>

      {snapshot.errorMessage && (
        <div className="text-red-500 text-xs mb-2 p-2 border border-red-900 bg-red-950/30">
          ERR_FATAL: {snapshot.errorMessage}
        </div>
      )}

      {/* BODY */}
      <div className="flex flex-1 gap-6 relative z-10 p-2">
        
        {/* LEFT: INPUT */}
        <div className="flex-1 flex flex-col gap-4">
           <label className="text-[10px] text-green-700 font-bold mb-[-8px]">TARGET_RSS_NODE</label>
           <div className="flex gap-2">
             <input 
               type="text"
               value={inputUrl}
               onChange={e => setInputUrl(e.target.value)}
               placeholder="> inject xml stream_url..."
               className="flex-1 bg-black border border-green-900 p-3 rounded-none font-mono text-sm focus:border-green-500 outline-none text-green-400 placeholder:text-green-900"
             />
             <button 
               onClick={() => handleFetch(inputUrl)}
               disabled={!inputUrl}
               className="bg-green-900/30 hover:bg-green-800 border border-green-700 disabled:opacity-30 text-green-300 px-6 font-bold"
             >
               FETCH
             </button>
           </div>

           <div className="mt-4">
             <span className="text-[10px] text-green-800 mb-2 block">KNOWN_NODES</span>
             <div className="flex flex-col gap-2">
               {PRESETS.map((p, i) => (
                 <button 
                   key={i} 
                   onClick={() => handleFetch(p.url)}
                   className="text-left bg-black hover:bg-green-950 p-2 border border-green-900/50 text-xs flex justify-between"
                 >
                   <span className="text-green-600">{p.name}</span>
                   <span className="text-green-800">EXEC →</span>
                 </button>
               ))}
             </div>
           </div>
        </div>

        {/* RIGHT: MARQUEE TERMINAL */}
        <div className="w-1/2 flex flex-col bg-black p-4 border border-green-900 justify-center min-h-[150px]">
           {snapshot.status === 'playing' && snapshot.headlines.length > 0 ? (
             <div className="flex flex-col gap-2">
                <span className="text-[10px] text-green-800 block">DECRYPTED_PAYLOAD [{snapshot.currentIndex + 1}/{snapshot.headlines.length}]</span>
                <span className="text-green-600 text-xs">{snapshot.headlines[snapshot.currentIndex].pubDate}</span>
                <p className="text-green-400 text-xl font-bold leading-tight uppercase animate-pulse">
                  {snapshot.headlines[snapshot.currentIndex].title}
                </p>
             </div>
           ) : snapshot.status === 'fetching' ? (
             <span className="text-green-600 text-sm animate-bounce">Retrieving packets... _</span>
           ) : (
             <span className="text-green-900 text-sm">AWAITING CONNECTION... _</span>
           )}
        </div>

      </div>

      <div className="border-t border-green-900/50 pt-2 mt-2 flex justify-between relative z-10">
         <span className="text-[10px] text-green-800">CYPHER_TEXT_PROTOCOL // AUDIO_SYS_MUTED</span>
         <button onClick={handleStop} className="text-[10px] text-red-500 hover:text-red-400">ABORT_CONN</button>
      </div>

    </div>
  );
};
