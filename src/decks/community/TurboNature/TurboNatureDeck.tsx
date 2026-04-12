// @ts-nocheck
import React, { useState, useEffect, useRef, FC } from 'react';
import { TurboNatureEngine } from './TurboNatureEngine';
import { TurboNatureSnapshot, defaultSynth, ENVIRONMENTS, EnvironmentId, SynthParamId } from './types';

export interface TurboNatureDeckProps {
  deckId: string;
  color?: string;
  onSwitchToTrack?: () => void;
}

export interface KnobProps { value: number; label: string; onChange: (v: number) => void; }
const Knob: FC<KnobProps> = ({ value, label, onChange }) => (
  <div className="flex flex-col items-center">
    <span className="text-[10px] text-gray-400 font-mono truncate max-w-[60px] mb-1">{label}</span>
    <input 
      type="range" min="0" max="1" step="0.01" 
      value={value} onChange={e => onChange(parseFloat(e.target.value))} 
      className="w-16 h-2 accent-[#00ffcc]"
    />
  </div>
);

// Global YouTube API promise
let loadYT: Promise<any> | null = null;
const loadYouTubeAPI = () => {
    if (!loadYT) {
        loadYT = new Promise((resolve) => {
            if ((window as any).YT && (window as any).YT.Player) {
                resolve((window as any).YT);
                return;
            }
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
            (window as any).onYouTubeIframeAPIReady = () => {
                resolve((window as any).YT);
            };
        });
    }
    return loadYT;
};

export const TurboNatureDeck: FC<TurboNatureDeckProps> = ({ deckId, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboNatureSnapshot>({
    isPlaying: false,
    masterVolume: 1.0,
    environment: 'forest',
    synth: defaultSynth(),
  });

  const engineRef = useRef<TurboNatureEngine | null>(null);
  const playerRef = useRef<any>(null);
  const containerId = `yt-player-${deckId}`;

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new TurboNatureEngine(deckId);
    engineRef.current = engine;
    
    const ctx = new window.AudioContext();
    if (ctx.state === 'running') ctx.suspend(); // Start suspended until play

    let isMounted = true;

    // Load YT API and initialize Engine + Player
    loadYouTubeAPI().then(YT => {
        if (!isMounted) return;
        
        const initialVideoId = ENVIRONMENTS.find(e => e.id === 'forest')?.videoId || '2jIMBAcrXPg';

        playerRef.current = new YT.Player(containerId, {
            height: '100%',
            width: '100%',
            videoId: initialVideoId,
            playerVars: {
                'autoplay': 0,
                'controls': 0,
                'disablekb': 1,
                'fs': 0,
                'loop': 1,
                'modestbranding': 1,
                'playsinline': 1,
                'playlist': initialVideoId // Required for looping single video
            },
            events: {
                'onReady': (event: any) => {
                    if (!isMounted) return;
                    engine.linkPlayer(event.target);
                    engine.init(ctx).then(() => {
                        setIsReady(true);
                    });
                }
            }
        });
    });
    
    return () => {
      isMounted = false;
      engine.destroy();
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
          playerRef.current.destroy();
      }
      ctx.close();
    };
  }, [deckId, containerId]);

  if (!isReady || !engineRef.current) {
    return (
      <div className="flex flex-col h-full w-full bg-black/80 text-white rounded-lg p-4 font-mono items-center justify-center border border-[#00ffcc]/30 shadow-[0_0_30px_rgb(0,255,204,0.1)]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-t-2 border-b-2" style={{ borderColor: '#00ffcc', animation: 'spin 1s linear infinite' }} />
          <span className="text-xs tracking-widest text-[#00ffcc]">BUFFERING ECOSYSTEM...</span>
        </div>
      </div>
    );
  }
  
  const engine = engineRef.current;

  // Actions
  const handlePlayToggle = () => {
    if (snapshot.isPlaying) {
      engine.stop();
      setSnapshot(s => ({ ...s, isPlaying: false }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isPlaying: true }));
    }
  };

  const setEnvironment = (envId: EnvironmentId) => {
      const env = ENVIRONMENTS.find(e => e.id === envId);
      if (env && playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
          playerRef.current.loadVideoById({
              videoId: env.videoId,
              startSeconds: 0
          });
          // Ensuring loop playlist is updated
          playerRef.current.setLoop(true);
          setSnapshot(s => ({ ...s, environment: envId }));
      }
  };

  const handleSynthChange = (param: SynthParamId, value: number) => {
      engine.setSynthParam(param, value);
      setSnapshot(s => ({ ...s, synth: { ...s.synth, [param]: value } }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-black/80 text-white rounded-lg font-mono relative overflow-hidden border border-[#00ffcc]/30 shadow-[0_0_30px_rgb(0,255,204,0.1)] group">
      
      {/* BACKGROUND VIDEO */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40 mix-blend-screen scale-110 filter saturate-150 contrast-125 pointer-events-none">
          <div id={containerId} className="w-full h-full pointer-events-none origin-center" />
      </div>
      
      {/* Color tint matching wind/rain logic */}
      <div 
         className="absolute inset-0 bg-[#00ffcc] pointer-events-none transition-opacity duration-1000" 
         style={{ opacity: (snapshot.synth.magic * 0.3) + 0.05, mixBlendMode: 'overlay' }}
      />
      <div 
         className="absolute inset-0 bg-blue-900 pointer-events-none transition-opacity duration-1000" 
         style={{ opacity: snapshot.synth.rain * 0.4, mixBlendMode: 'overlay' }}
      />

      <div className="relative z-10 flex flex-col h-full p-4">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6 border-b border-[#00ffcc]/30 pb-2">
          <div className="flex items-center gap-4">
            <span className="font-bold text-lg text-[#00ffcc]">DECK {deckId} [TurboNature]</span>
            <span className="text-gray-400 text-xs tracking-widest hidden sm:inline-block">HD AMBIENT GENERATOR</span>
          </div>
          {onSwitchToTrack && <button onClick={onSwitchToTrack} className="text-gray-400 hover:text-white">[×]</button>}
        </div>

        {/* BODY - ENVIRONMENT SELECTORS & NOISE CONTROLS */}
        <div className="relative z-10 flex flex-col flex-1 justify-center items-center gap-6 mb-6 mt-2">
          
          {/* Environments */}
          <div className="flex flex-wrap justify-center gap-3 w-full px-4">
              {ENVIRONMENTS.map(env => (
                  <button 
                      key={env.id}
                      onClick={() => setEnvironment(env.id)}
                      className={`px-4 py-2 border rounded-full text-xs transition-all tracking-widest
                        ${snapshot.environment === env.id 
                            ? 'bg-[#00ffcc]/20 border-[#00ffcc] text-white shadow-[0_0_15px_rgba(0,255,204,0.4)]' 
                            : 'bg-black/40 border-white/10 text-gray-400 hover:border-[#00ffcc]/50 hover:text-[#00ffcc]'
                        }
                      `}
                  >
                      {env.name.toUpperCase()}
                  </button>
              ))}
          </div>

          <div className="w-[80%] h-[1px] bg-gradient-to-r from-transparent via-[#00ffcc]/20 to-transparent my-2" />

          {/* Synth Overlays */}
          <div className="flex flex-wrap justify-center gap-6 bg-black/40 backdrop-blur-xl p-6 rounded-3xl border border-[#00ffcc]/20 shadow-[0_0_30px_rgba(0,255,204,0.1)] group-hover:border-[#00ffcc]/40 transition-colors">
            <Knob label="BIRDS" value={snapshot.synth.birds} onChange={(v) => handleSynthChange('birds', v)} />
            <Knob label="MAGIC" value={snapshot.synth.magic} onChange={(v) => handleSynthChange('magic', v)} />
            <Knob label="WIND" value={snapshot.synth.wind} onChange={(v) => handleSynthChange('wind', v)} />
            <Knob label="RAIN" value={snapshot.synth.rain} onChange={(v) => handleSynthChange('rain', v)} />
          </div>
        </div>

        {/* TRANSPORT */}
        <div className="relative z-10 flex justify-between items-center border-t border-[#00ffcc]/30 pt-4 bg-black/40 backdrop-blur-md p-3 rounded-xl shadow-inner mt-auto">
          <button 
            onClick={handlePlayToggle}
            className="px-8 py-3 border-2 rounded font-bold tracking-widest transition-all"
            style={{ 
              borderColor: snapshot.isPlaying ? '#00ffcc' : 'gray', 
              color: snapshot.isPlaying ? '#ccfffe' : 'white',
              backgroundColor: snapshot.isPlaying ? 'rgba(0,255,204,0.15)' : 'transparent',
              boxShadow: snapshot.isPlaying ? '0 0 20px rgba(0,255,204,0.3)' : 'none'
            }}
          >
            {snapshot.isPlaying ? 'STREAMING' : 'INITIATE'}
          </button>
          
          <div className="flex gap-4 items-center bg-black/50 p-2 rounded-lg border border-white/5">
            <Knob 
              label="Volume" 
              value={snapshot.masterVolume} 
              onChange={(v: number) => { engine.masterVolume = v; setSnapshot(s => ({...s, masterVolume: v})) }} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};
