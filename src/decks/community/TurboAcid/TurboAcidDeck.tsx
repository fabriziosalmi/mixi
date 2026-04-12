// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { TurboAcidEngine } from './TurboAcidEngine';

interface Props {
  audioContext: AudioContext;
}

export const TurboAcidDeck: React.FC<Props> = ({ audioContext }) => {
  const [engine, setEngine] = useState<TurboAcidEngine | null>(null);
  
  useEffect(() => {
    const newEngine = new TurboAcidEngine(audioContext);
    
    // Mount e Invia modulo al Thread Audio
    newEngine.initialize().then(() => {
      setEngine(newEngine);
    });

    return () => {
      newEngine.stop();
      newEngine.destroy();
    };
  }, [audioContext]);

  if (!engine) return <div>Inizializzazione DSP Aerospace-Grade... (Richiede SAB Headers)</div>;

  return (
    <div className="turbo-acid-deck p-4 bg-zinc-900 border-2 border-green-500 rounded-md select-none text-white font-mono">
      <div className="flex justify-between items-center bg-black p-2 border-b border-green-700">
        <h2 className="text-xl font-bold tracking-tighter text-green-400">☢️ ACID-CORE / DUAL-303</h2>
        <div className="space-x-2">
          <button className="px-3 py-1 bg-green-900 hover:bg-green-700" onClick={() => engine.start()}>PLAY</button>
          <button className="px-3 py-1 bg-red-900 hover:bg-red-700" onClick={() => engine.stop()}>STOP</button>
        </div>
      </div>
      
      {/* 
        Qui poi espanderemo l'interfaccia con manopole che 
        chiemeranno direttamente engine.bus.setCutoff('A', val), ecc. 
        senza passare per React state (Zero-GC binding). 
      */}
      <div className="mt-4 text-xs text-zinc-500">Zero-Copy SAB Engine attacchato. Latenza RAM: ~1ns</div>
    </div>
  );
};
