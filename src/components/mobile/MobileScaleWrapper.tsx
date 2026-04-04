import { useEffect, useState, type FC, type ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────
// MobileScaleWrapper — Adaptive virtual resolution
//
// Desktop (≥1100×700):      no scaling, passthrough
// Portrait mobile:           scale to fit 1100×700 virtual canvas
// Landscape mobile (≤500h):  scale to fit 1100×540 compact canvas
//                            + adds .mixi-compact CSS class
// ─────────────────────────────────────────────────────────────

const DESKTOP_W = 1100;
const DESKTOP_H = 700;

// Compact mode: reduced virtual height for landscape mobile
const COMPACT_H = 540;
// Activate compact when: landscape ratio AND height ≤ threshold
const COMPACT_MAX_HEIGHT = 500;

export const MobileScaleWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const [scale, setScale] = useState(1);
  const [needsScaling, setNeedsScaling] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Determine if we should use compact (landscape mobile) mode
      const landscapeMobile = w > h && h <= COMPACT_MAX_HEIGHT && w >= 640;

      const virtualW = DESKTOP_W;
      const virtualH = landscapeMobile ? COMPACT_H : DESKTOP_H;

      if (w < virtualW || h < virtualH) {
        setNeedsScaling(true);
        setIsCompact(landscapeMobile);
        const scaleW = w / virtualW;
        const scaleH = h / virtualH;
        setScale(Math.min(scaleW, scaleH));
      } else {
        setNeedsScaling(false);
        setIsCompact(false);
        setScale(1);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!needsScaling) {
    return <>{children}</>;
  }

  return (
    <div
      className={isCompact ? 'mixi-compact' : ''}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
      }}
    >
      <div
        style={{
          width: DESKTOP_W,
          height: isCompact ? COMPACT_H : DESKTOP_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
};
