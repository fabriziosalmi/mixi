/**
 * Wrapper that adapts TurboAcidDeck (audioContext-based interface)
 * to HouseDeckProps (deckId/color/onSwitchToTrack) used by MIXI.
 */
import { useState, useEffect, type FC } from 'react';
import { TurboAcidDeck } from './TurboAcidDeck';

interface HouseDeckProps {
  deckId: string;
  color: string;
  onSwitchToTrack: () => void;
}

export const TurboAcidDeckAdapter: FC<HouseDeckProps> = ({ color, onSwitchToTrack }) => {
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    // Get AudioContext from MixiEngine singleton
    try {
      const engine = (window as any).__MIXI_ENGINE__;
      if (engine?.getAudioContext) {
        setCtx(engine.getAudioContext());
      } else {
        // Fallback: create own context
        setCtx(new AudioContext());
      }
    } catch {
      setCtx(new AudioContext());
    }
  }, []);

  if (!ctx) {
    return (
      <div style={{ padding: 16, color: '#555', fontFamily: 'monospace', textAlign: 'center' }}>
        Initializing AudioContext...
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onSwitchToTrack}
        style={{
          position: 'absolute', top: 4, right: 4, zIndex: 10,
          background: 'none', border: `1px solid ${color}44`, borderRadius: 4,
          color: '#888', padding: '2px 8px', fontSize: 10, cursor: 'pointer',
          fontFamily: 'monospace',
        }}
      >
        TRACK
      </button>
      <TurboAcidDeck audioContext={ctx} />
    </div>
  );
};
