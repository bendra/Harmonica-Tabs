import { describe, expect, it } from 'vitest';
import { parseBoundedInteger } from '../../src/hooks/use-audio-settings';
import { AUDIO_SETTINGS_LIMITS, DEFAULT_AUDIO_SETTINGS } from '../../src/config/default-settings';

describe('minSendIntervalMs clamping (native rate-limit floor guard)', () => {
  const { min, max } = AUDIO_SETTINGS_LIMITS.minSendIntervalMs;
  const fallback = DEFAULT_AUDIO_SETTINGS.minSendIntervalMs;

  it('keeps the documented perf floor, default, and ceiling', () => {
    // The 50ms floor is load-bearing: below it the Swift→JS bridge queue grows
    // unbounded again. If anyone weakens these, this fails loudly.
    expect(min).toBe(50);
    expect(fallback).toBe(50);
    expect(max).toBe(400);
  });

  it('clamps a sub-floor value up to the minimum', () => {
    expect(parseBoundedInteger('25', fallback, min, max)).toBe(50);
    expect(parseBoundedInteger('1', fallback, min, max)).toBe(50);
  });

  it('clamps an excessive value down to the maximum', () => {
    expect(parseBoundedInteger('9999', fallback, min, max)).toBe(400);
  });

  it('falls back to the default for empty or non-numeric input', () => {
    expect(parseBoundedInteger('', fallback, min, max)).toBe(50);
    expect(parseBoundedInteger('abc', fallback, min, max)).toBe(50);
  });

  it('passes through an in-range value unchanged', () => {
    expect(parseBoundedInteger('120', fallback, min, max)).toBe(120);
  });
});
