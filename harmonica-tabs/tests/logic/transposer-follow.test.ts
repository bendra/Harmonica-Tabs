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
  it('advances when the target note is held long enough with enough confidence', () => {
    const holding = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_000,
    });

    expect(holding.status).toBe('holding');
    expect(holding.state).toEqual({
      activeTokenIndex: 0,
      matchedSince: 1_000,
      waitingForRelease: false,
    });

    const advanced = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: holding.state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_320,
    });

    expect(advanced.status).toBe('advanced');
    expect(advanced.state).toEqual({
      activeTokenIndex: 1,
      matchedSince: null,
      waitingForRelease: true,
    });
  });

  it('does not advance when confidence is below the threshold', () => {
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
      holdDurationMs: 300,
      now: 1_000,
    });

    expect(result.status).toBe('listening');
    expect(result.state).toEqual({
      activeTokenIndex: 0,
      matchedSince: null,
      waitingForRelease: false,
    });
  });

  it('does not advance when the detected note is outside tolerance', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72) * 1.03,
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_000,
    });

    expect(result.status).toBe('no-match');
    expect(result.state).toEqual({
      activeTokenIndex: 0,
      matchedSince: null,
      waitingForRelease: false,
    });
  });

  it('resets hold progress when signal drops out', () => {
    const holding = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_000,
    });

    const reset = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: holding.state,
      detector: createDetectorSnapshot({
        frequency: null,
        confidence: 0,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_100,
    });

    expect(reset.status).toBe('listening');
    expect(reset.state).toEqual({
      activeTokenIndex: 0,
      matchedSince: null,
      waitingForRelease: false,
    });
  });

  it('requires a release before repeated identical notes can advance again', () => {
    const firstAdvance = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: {
        activeTokenIndex: 1,
        matchedSince: 1_000,
        waitingForRelease: false,
      },
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_350,
    });

    expect(firstAdvance.status).toBe('advanced');
    expect(firstAdvance.state).toEqual({
      activeTokenIndex: 2,
      matchedSince: null,
      waitingForRelease: true,
    });

    const waiting = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: firstAdvance.state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_500,
    });

    expect(waiting.status).toBe('waiting-for-release');
    expect(waiting.state.waitingForRelease).toBe(true);

    const released = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: waiting.state,
      detector: createDetectorSnapshot({
        frequency: null,
        confidence: 0,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_600,
    });

    expect(released.status).toBe('listening');
    expect(released.state).toEqual({
      activeTokenIndex: 2,
      matchedSince: null,
      waitingForRelease: false,
    });
  });

  it('clears hold progress when the cursor is moved manually', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: {
        activeTokenIndex: 2,
        matchedSince: null,
        waitingForRelease: false,
      },
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
      holdDurationMs: 300,
      now: 1_000,
    });

    expect(result.status).toBe('holding');
    expect(result.state).toEqual({
      activeTokenIndex: 2,
      matchedSince: 1_000,
      waitingForRelease: false,
    });
  });
});
