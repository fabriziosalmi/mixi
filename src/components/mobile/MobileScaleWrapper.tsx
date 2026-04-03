import { useEffect, useState, type FC, type ReactNode } from 'react';

// Force an absolute minimum virtual resolution for the DAW.
// On screens smaller than this, the entire interface will scale down proportionally.
const MIN_DESKTOP_WIDTH = 1100;
const MIN_DESKTOP_HEIGHT = 700;

export const MobileScaleWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const [scale, setScale] = useState(1);
  const [needsScaling, setNeedsScaling] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      if (w < MIN_DESKTOP_WIDTH || h < MIN_DESKTOP_HEIGHT) {
        setNeedsScaling(true);
        // Calculate the scale needed to fit both dimensions
        const scaleW = w / MIN_DESKTOP_WIDTH;
        const scaleH = h / MIN_DESKTOP_HEIGHT;
        // Use the smaller scale to ensure it fits entirely on screen
        setScale(Math.min(scaleW, scaleH));
      } else {
        setNeedsScaling(false);
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
          width: MIN_DESKTOP_WIDTH,
          height: MIN_DESKTOP_HEIGHT,
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
