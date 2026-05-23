import { describe, expect, it } from 'vitest';
import { isStaleFrame } from '../../src/logic/native-audio-policy';

describe('isStaleFrame (native bridge backlog guard)', () => {
  it('passes a fresh frame', () => {
    expect(isStaleFrame(1000, 1100, 500)).toBe(false);
  });

  it('drops a frame older than the threshold', () => {
    expect(isStaleFrame(1000, 1600, 500)).toBe(true);
  });

  it('treats the exact threshold as not stale (exclusive boundary)', () => {
    expect(isStaleFrame(1000, 1500, 500)).toBe(false);
  });

  it('always passes frames with no capture timestamp (safety net)', () => {
    expect(isStaleFrame(null, 999999, 500)).toBe(false);
  });
});
