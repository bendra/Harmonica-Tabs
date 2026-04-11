import { describe, expect, it } from 'vitest';
import {
  createTransposerFollowState,
  evaluateTransposerFollow,
  type DetectorSnapshot,
} from '../../src/logic/transposer-follow';
import { midiToFrequency } from '../../src/logic/pitch';

const TOKENS = [
  { tokenIndex: 0, text: '4', midi: 72 },
  { tokenIndex: 1, text: '-4', midi: 73 },
  { tokenIndex: 2, text: '-4', midi: 73 },
];

function createDetectorSnapshot(overrides: Partial<DetectorSnapshot> = {}): DetectorSnapshot {
  return {
    frequency: null,
    confidence: 0,
    rms: 0,
    source: 'web',
    lastDetectedAt: null,
    ...overrides,
  };
}

describe('evaluateTransposerFollow', () => {
  it('highlights current note without advancing when player matches it', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('matching-current');
    expect(result.matchingTarget).toBe(true);
    expect(result.state).toEqual({
      activeTokenIndex: 0,
      waitingForRelease: false,
    });
  });

  it('advances when player plays the next note', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('advanced');
    expect(result.matchingTarget).toBe(true);
    expect(result.state).toEqual({
      activeTokenIndex: 1,
      waitingForRelease: true,
    });
  });

  it('does not advance on current-note match alone', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.state.activeTokenIndex).toBe(0);
  });

  it('returns no-match when pitch is outside tolerance of both current and next', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(60), // far from midi 72 or 73
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('no-match');
    expect(result.matchingTarget).toBe(false);
    expect(result.state.activeTokenIndex).toBe(0);
  });

  it('returns listening when confidence is below the threshold', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.1,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('listening');
    expect(result.matchingTarget).toBe(false);
  });

  it('blocks advancement while pitch persists on newly advanced token', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: { activeTokenIndex: 1, waitingForRelease: true },
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('waiting-for-release');
    expect(result.matchingTarget).toBe(true);
    expect(result.state).toEqual({ activeTokenIndex: 1, waitingForRelease: true });
  });

  it('clears waitingForRelease when pitch drops', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: { activeTokenIndex: 1, waitingForRelease: true },
      detector: createDetectorSnapshot({ frequency: null, confidence: 0 }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('listening');
    expect(result.state).toEqual({ activeTokenIndex: 1, waitingForRelease: false });
  });

  it('requires a release between consecutive same-pitch tokens', () => {
    // Advance from index 1 to index 2 (both midi 73)
    const firstAdvance = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(1),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(firstAdvance.status).toBe('advanced');
    expect(firstAdvance.state).toEqual({ activeTokenIndex: 2, waitingForRelease: true });

    // Still holding same pitch — blocked
    const stillHolding = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: firstAdvance.state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(stillHolding.status).toBe('waiting-for-release');
    expect(stillHolding.state.waitingForRelease).toBe(true);

    // Release
    const released = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: stillHolding.state,
      detector: createDetectorSnapshot({ frequency: null, confidence: 0 }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(released.status).toBe('listening');
    expect(released.state).toEqual({ activeTokenIndex: 2, waitingForRelease: false });
  });

  it('wraps back to the first token when the next note after the last matches', () => {
    // At index 2 (last), next wraps to index 0 (midi 72)
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(2),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('advanced');
    expect(result.state).toEqual({ activeTokenIndex: 0, waitingForRelease: true });
  });

  it('returns idle when there is no audio source', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({ source: null }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('idle');
  });

  it('clears waitingForRelease when disabled', () => {
    const result = evaluateTransposerFollow({
      enabled: false,
      tokens: TOKENS,
      state: { activeTokenIndex: 1, waitingForRelease: true },
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.state.waitingForRelease).toBe(false);
  });
});
