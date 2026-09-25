import { describe, expect, it } from 'vitest';
import { defaultView, textPx, TEXT_PX } from './view';

// Map text size (US-029).
describe('textPx (US-029)', () => {
  const grow = { ...defaultView, grow: true, textSize: 1 };
  const fixed = { ...defaultView, grow: false, textSize: 1 };

  it('follows the zoom between the bounds when growing', () => {
    expect(textPx('program', 20, grow)).toBe(20);
    expect(textPx('program', 1, grow)).toBe(TEXT_PX.program.min);
    expect(textPx('program', 500, grow)).toBe(TEXT_PX.program.max);
  });

  it('stays one size at every zoom when not growing', () => {
    expect(textPx('degree', 1, fixed)).toBe(TEXT_PX.degree.fixed);
    expect(textPx('degree', 500, fixed)).toBe(TEXT_PX.degree.fixed);
  });

  it('scales both modes by the text size, and keeps the text size in range', () => {
    expect(textPx('subject', 10, { ...grow, textSize: 2 })).toBe(20);
    expect(textPx('subject', 10, { ...fixed, textSize: 0.5 })).toBe(TEXT_PX.subject.fixed / 2);
    expect(textPx('subject', 10, { ...fixed, textSize: 9 })).toBe(TEXT_PX.subject.fixed * 2);
  });
});
