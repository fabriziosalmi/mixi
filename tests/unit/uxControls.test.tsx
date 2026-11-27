import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Knob } from '../../src/components/controls/Knob';
import { Fader } from '../../src/components/controls/Fader';

describe('UX-1 / UX-2 / UX-3: Knob & Fader Tactile + Keyboard Controls', () => {
  it('Knob: supports keyboard ArrowUp/Down, Home/End, Shift fine-step, and Backspace reset', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Knob value={0} min={-12} max={12} center={0} bipolar label="LOW" onChange={onChange} />,
    );
    const slider = getByRole('slider', { name: 'LOW' });

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(1.2, 4)); // 5% of 24 = 1.2

    fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.24, 4)); // 1% of 24 = 0.24

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(-12);

    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(12);

    fireEvent.keyDown(slider, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('Knob: supports mouse wheel adjustments with Shift fine-tune', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Knob value={0.5} min={0} max={1} label="GAIN" onChange={onChange} />,
    );
    const slider = getByRole('slider', { name: 'GAIN' });

    fireEvent.wheel(slider, { deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.52, 4));

    fireEvent.wheel(slider, { deltaY: -100, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.505, 4));
  });

  it('Knob: EQ KILL button exposes accessible aria-pressed and stays visible without hover', () => {
    const onKill = vi.fn();
    const { getByRole } = render(
      <Knob value={0} min={-26} max={6} center={0} bipolar label="LOW" showValue onKill={onKill} killed={false} onChange={() => {}} />,
    );
    const btn = getByRole('button', { name: 'Kill LOW' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.className).not.toContain('opacity-0');
    fireEvent.click(btn);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('Fader: supports double-click reset (horizontal defaults to midpoint), keyboard arrows, and wheel', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Fader value={0.8} min={0} max={1} orientation="horizontal" label="XFADER" onChange={onChange} />,
    );
    const slider = getByRole('slider', { name: 'XFADER' });

    fireEvent.doubleClick(slider);
    expect(onChange).toHaveBeenLastCalledWith(0.5);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.75, 4));

    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.79, 4));

    fireEvent.wheel(slider, { deltaY: 100 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.78, 4));
  });

  it('Fader: vertical fader resets to explicit defaultValue on double-click and Backspace', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Fader value={0.3} min={0} max={1} defaultValue={1} orientation="vertical" label="VOL A" onChange={onChange} />,
    );
    const slider = getByRole('slider', { name: 'VOL A' });

    fireEvent.doubleClick(slider);
    expect(onChange).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(slider, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
