import { useEffect, useState, type FC, type ReactNode, type CSSProperties } from 'react';

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

  // IMPORTANT: render an IDENTICAL element structure (div > div > children) in
  // both the scaled and unscaled states. Previously the unscaled case returned
  // `<>{children}</>` while the scaled case wrapped children in two <div>s — so
  // toggling `needsScaling` (e.g. a window resize crossing the 1100×700 / 540
  // threshold) changed the element path around <App/>, forcing React to UNMOUNT
  // and REMOUNT the entire app. That destroyed/recreated the AudioContext and
  // tore the WebSocket bridge down mid-connect on every toggle. Keeping the tree
  // shape constant and toggling only styles preserves <App/>'s instance.
  // When not scaling, both wrappers use `display: contents` so they generate no
  // box and the desktop layout is exactly as if children were rendered directly.
  const outerStyle: CSSProperties = needsScaling
    ? {
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
      }
    : { display: 'contents' };

  const innerStyle: CSSProperties = needsScaling
    ? {
        width: DESKTOP_W,
        height: isCompact ? COMPACT_H : DESKTOP_H,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        position: 'relative',
      }
    : { display: 'contents' };

  return (
    <div className={isCompact ? 'mixi-compact' : ''} style={outerStyle}>
      <div style={innerStyle}>{children}</div>
    </div>
  );
};
