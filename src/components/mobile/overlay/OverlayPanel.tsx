/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlayPanel — Slide-up container for mobile controls
//
// Slides up from the bottom covering ~55% of the screen.
// Semi-transparent backdrop. Swipe down or tap backdrop to close.
// Tab bar at top for switching between EQ / PADS panels.
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, useState, type FC, type ReactNode } from 'react';
import type { DeckId } from '../../../types';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../../theme';

export type OverlayTab = 'eq' | 'pads' | 'fx' | 'hp';

interface OverlayPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeDeck: DeckId;
  onDeckSwitch: (deck: DeckId) => void;
  activeTab: OverlayTab;
  onTabChange: (tab: OverlayTab) => void;
  children: ReactNode;
}

const TABS: { id: OverlayTab; label: string }[] = [
  { id: 'eq', label: 'EQ' },
  { id: 'pads', label: 'PADS' },
  { id: 'fx', label: 'FX' },
  { id: 'hp', label: 'HP' },
];

export const OverlayPanel: FC<OverlayPanelProps> = ({
  isOpen,
  onClose,
  activeDeck,
  onDeckSwitch,
  activeTab,
  onTabChange,
  children,
}) => {
  // ── Swipe-to-close ──
  const startYRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startYRef.current = e.clientY;
    setDragging(true);
    setDragOffset(0);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dy = e.clientY - startYRef.current;
    if (dy > 0) setDragOffset(dy); // only allow downward drag
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    if (dragOffset > 60) {
      onClose();
    }
    setDragOffset(0);
  }, [dragOffset, onClose]);

  if (!isOpen) return null;

  const deckColor = activeDeck === 'A' ? COLOR_DECK_A : COLOR_DECK_B;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        className="m-overlay-backdrop-enter"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Panel */}
      <div
        className={dragOffset === 0 ? 'm-overlay-enter' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          height: '55vh',
          background: 'rgba(10, 10, 10, 0.75)',
          backdropFilter: 'blur(16px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
          borderTop: `2px solid ${deckColor}44`,
          borderRadius: '12px 12px 0 0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
          touchAction: 'none',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
        </div>

        {/* Header: deck switch + tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px 6px',
            borderBottom: '1px solid #222',
            flexShrink: 0,
          }}
        >
          {/* Deck A/B toggle */}
          {(['A', 'B'] as DeckId[]).map((d) => (
            <button
              key={d}
              onClick={() => onDeckSwitch(d)}
              style={{
                width: 36,
                height: 28,
                border: `1px solid ${activeDeck === d ? (d === 'A' ? COLOR_DECK_A : COLOR_DECK_B) : '#333'}`,
                borderRadius: 4,
                background: activeDeck === d ? `${d === 'A' ? COLOR_DECK_A : COLOR_DECK_B}22` : 'transparent',
                color: activeDeck === d ? (d === 'A' ? COLOR_DECK_A : COLOR_DECK_B) : '#666',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {d}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Tabs */}
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                padding: '4px 14px',
                border: `1px solid ${activeTab === tab.id ? deckColor : '#333'}`,
                borderRadius: 4,
                background: activeTab === tab.id ? `${deckColor}22` : 'transparent',
                color: activeTab === tab.id ? deckColor : '#666',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
};
