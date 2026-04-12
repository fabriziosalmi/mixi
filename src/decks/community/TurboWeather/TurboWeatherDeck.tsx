// @ts-nocheck
import React, { useState, useEffect, useRef, FC } from 'react';
import { TurboWeatherEngine, DeckId } from './TurboWeatherEngine';
import { TurboWeatherSnapshot } from './types';

export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

export const TurboWeatherDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<TurboWeatherSnapshot>({
    isActive: false,
    latitude: 51.5074, // London
    longitude: -0.1278,
    isFetching: false,
    windSpeed: 0,
    temperature: 0,
    weatherCode: 0,
    masterVolume: 1.0,
  });

  const engineRef = useRef<TurboWeatherEngine | null>(null);

  useEffect(() => {
    const engine = new TurboWeatherEngine(deckId);
    engine.init(new window.AudioContext());
    engineRef.current = engine;

    engine.onWeatherUpdate = (data) => {
      setSnapshot(s => ({ ...s, ...data }));
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
      engine.lat = snapshot.latitude;
      engine.lon = snapshot.longitude;
      engine.engage();
      setSnapshot(s => ({ ...s, isActive: true }));
    }
  };

  const syncWeather = () => {
    if (snapshot.isActive) {
      engine.lat = snapshot.latitude;
      engine.lon = snapshot.longitude;
      engine.fetchWeather();
    }
  };

  // Very rough WMO code mapper
  const getWeatherDesc = (code: number) => {
    if (code === 0) return 'CLEAR SKY';
    if (code <= 3) return 'PARTLY CLOUDY';
    if (code < 50) return 'FOG / HAZE';
    if (code < 70) return 'RAIN / DRIZZLE';
    if (code < 80) return 'SNOWFALL';
    if (code >= 80) return 'THUNDERSTORM / SHOWERS';
    return 'UNKNOWN ATMOSPHERE';
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#e6f2ff] border border-blue-400 text-blue-900 rounded-lg p-4 font-mono shadow-[0_0_20px_rgba(150,200,255,0.4)]">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4 border-b border-blue-300 pb-2">
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg" style={{ color: color || '#1e3a8a' }}>DECK {deckId} [TurboWeather]</span>
          <span className="text-xs uppercase px-2 bg-blue-200 text-blue-800">
            {snapshot.isActive ? 'ATMOSPHERE CATCHING' : 'IDLE'}
          </span>
        </div>
        <button onClick={onSwitchToTrack} className="text-blue-500 hover:text-blue-700">[×]</button>
      </div>

      {/* BODY */}
      <div className="flex flex-1 gap-6 p-2">
        
        {/* LEFT: CONTROLS */}
        <div className="w-1/2 flex flex-col gap-4">
           <button 
             onClick={handleToggle}
             className={`w-full py-2 font-bold transition-all border ${
               snapshot.isActive 
                 ? 'bg-blue-300 border-blue-600 text-blue-900' 
                 : 'bg-white border-blue-400 text-blue-700 hover:bg-blue-50'
             }`}
           >
             {snapshot.isActive ? 'SEAL ATMOSPHERE' : 'OPEN ATMOSPHERE'}
           </button>

           <div className="flex flex-col gap-2 p-3 bg-white/60 border border-blue-300">
              <span className="text-[10px] text-blue-600 font-bold">GPS TARGET</span>
              <div className="flex items-center gap-2">
                <input 
                  type="number" step="0.01" value={snapshot.latitude} 
                  onChange={e => setSnapshot(s => ({...s, latitude: parseFloat(e.target.value)}))}
                  className="w-20 bg-blue-50 border border-blue-200 text-xs p-1 text-center text-blue-900"
                />
                <span className="text-xs">LAT</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number" step="0.01" value={snapshot.longitude} 
                  onChange={e => setSnapshot(s => ({...s, longitude: parseFloat(e.target.value)}))}
                  className="w-20 bg-blue-50 border border-blue-200 text-xs p-1 text-center text-blue-900"
                />
                <span className="text-xs">LON</span>
              </div>
              <button onClick={syncWeather} disabled={snapshot.isFetching || !snapshot.isActive} className="mt-2 text-[10px] bg-blue-600 text-white disabled:opacity-50 py-1 uppercase font-bold">
                {snapshot.isFetching ? 'FETCHING OPEN-METEO...' : 'SYNC SONIC TELEMETRY'}
              </button>
           </div>
        </div>

        {/* RIGHT: METEO HUD */}
        <div className="flex-1 relative bg-gradient-to-b from-blue-100 to-blue-300 border-4 border-white flex flex-col items-center justify-center overflow-hidden p-4">
            <span className="absolute top-2 left-2 text-[10px] text-blue-800 font-bold">SONIC WEATHER MAPPING</span>
            
            {snapshot.isActive ? (
               <div className="flex flex-col items-center w-full mt-4">
                  <div className="text-4xl pb-2 font-bold animate-pulse text-blue-900">
                     {snapshot.windSpeed.toFixed(1)} <span className="text-sm">KM/H</span>
                  </div>
                  <div className="w-full text-center text-sm font-bold bg-white/50 py-1 shadow-sm text-blue-800">
                    WIND / NOISE GENERATOR
                  </div>

                  <div className="flex w-full justify-between mt-4">
                     <span className="text-3xl text-blue-800">{snapshot.temperature.toFixed(1)}°</span>
                     <div className="text-right">
                       <span className="text-[10px] block font-bold text-blue-700">WMO STATE</span>
                       <span className="text-xs font-bold leading-none bg-blue-600 text-white px-2 py-1 uppercase">{getWeatherDesc(snapshot.weatherCode)}</span>
                     </div>
                  </div>
               </div>
            ) : (
               <div className="text-blue-400 opacity-50 font-bold">NO TELEMETRY</div>
            )}

            {/* Artificial Clouds CSS */}
            {snapshot.isActive && (
              <div className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay flex gap-2">
                 <div className="w-full h-full bg-white rounded-full translate-x-[-20%] translate-y-[-50%] blur-xl" />
                 <div className="w-full h-full bg-white rounded-full translate-x-[20%] translate-y-[50%] blur-xl" />
              </div>
            )}
        </div>

      </div>
    </div>
  );
};
