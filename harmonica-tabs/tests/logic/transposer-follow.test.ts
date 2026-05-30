import { describe, expect, it } from 'vitest';
import {
  createTransposerFollowState,
  evaluateTransposerFollow as evaluateTransposerFollowBase,
  isMicDetectorSource,
  type DetectorSnapshot,
  type TransposerFollowState,
} from '../../src/logic/transposer-follow';
import { midiToFrequency } from '../../src/logic/pitch';

const NOTE_SEPARATION_RATIO = 0.4;

const TOKENS = [
  { tokenIndex: 0, text: '4', midi: 72 },
  { tokenIndex: 1, text: '-4', midi: 73 },
  { tokenIndex: 2, text: '-4', midi: 73 },
];

describe('isMicDetectorSource', () => {
  it('treats web, native, and webview as real microphone sources', () => {
    expect(isMicDetectorSource('web')).toBe(true);
    expect(isMicDetectorSource('native')).toBe(true);
    expect(isMicDetectorSource('webview')).toBe(true);
    expect(isMicDetectorSource('sim')).toBe(false);
    expect(isMicDetectorSource(null)).toBe(false);
  });
});

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

function evaluateTransposerFollow(
  input: Omit<Parameters<typeof evaluateTransposerFollowBase>[0], 'noteSeparationRatio'> & {
    noteSeparationRatio?: number;
  },
) {
  return evaluateTransposerFollowBase({
    noteSeparationRatio: NOTE_SEPARATION_RATIO,
    ...input,
  });
}

// Convenience: a state where we're already mid-note at `activeTokenIndex` with
// a known peak. Useful for tests that want to skip the first-attack ramp-up.
function midNoteState(activeTokenIndex: number, peak: number): TransposerFollowState {
  return {
    activeTokenIndex,
    waitingForRelease: true,
    peakRmsSinceAdvance: peak,
    releaseFloorRms: peak,
    prevAttackPeak: null,
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
      peakRmsSinceAdvance: 0,
      releaseFloorRms: Number.POSITIVE_INFINITY,
      prevAttackPeak: null,
    });
  });

  it('advances when player plays the next (different-pitch) note', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.02,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('advanced');
    expect(result.matchingTarget).toBe(true);
    expect(result.state).toEqual({
      activeTokenIndex: 1,
      waitingForRelease: true,
      peakRmsSinceAdvance: 0.02,
      releaseFloorRms: 0.02,
      prevAttackPeak: null,
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
      state: midNoteState(1, 0.02),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.02,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('waiting-for-release');
    expect(result.matchingTarget).toBe(true);
    expect(result.state).toEqual({
      activeTokenIndex: 1,
      waitingForRelease: true,
      peakRmsSinceAdvance: 0.02,
      releaseFloorRms: 0.02,
      prevAttackPeak: null,
    });
  });

  it('clears waitingForRelease and captures peak when pitch drops to silence', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: midNoteState(1, 0.02),
      detector: createDetectorSnapshot({ frequency: null, confidence: 0 }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('listening');
    // Silence drives the floor to zero, which fires the release and captures
    // the peak as our recovery reference for the next same-pitch articulation.
    expect(result.state).toEqual({
      activeTokenIndex: 1,
      waitingForRelease: false,
      peakRmsSinceAdvance: 0,
      releaseFloorRms: Number.POSITIVE_INFINITY,
      prevAttackPeak: 0.02,
    });
  });

  it('requires a release plus a real new attack between consecutive same-pitch tokens', () => {
    // Start mid-note at index 1, with a known peak so we can simulate a release.
    let state: TransposerFollowState = midNoteState(1, 0.20);

    // Frame 1: still loud — no release, no advance.
    const sustaining = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.18,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(sustaining.status).toBe('waiting-for-release');
    expect(sustaining.state.waitingForRelease).toBe(true);
    state = sustaining.state;

    // Frame 2: RMS dips below peak * ratio (0.20 * 0.4 = 0.08) — release fires.
    const released = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.05,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(released.state.waitingForRelease).toBe(false);
    expect(released.state.prevAttackPeak).toBeCloseTo(0.20);
    // Cursor must stay at 1 — we released but haven't re-articulated yet.
    expect(released.state.activeTokenIndex).toBe(1);
    state = released.state;

    // Frame 3: a real new attack — RMS climbs back above prev peak * recovery
    // ratio (0.20 * 0.5 = 0.10). Cursor advances to 2.
    const reattacked = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.12,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(reattacked.status).toBe('advanced');
    expect(reattacked.state.activeTokenIndex).toBe(2);
  });

  it('keeps waiting when a same-pitch RMS dip is too shallow', () => {
    const result = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state: midNoteState(1, 0.1),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.05, // 0.05 > 0.1 * 0.4 = 0.04, so no release
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.status).toBe('waiting-for-release');
    expect(result.state.waitingForRelease).toBe(true);
    expect(result.state.peakRmsSinceAdvance).toBeCloseTo(0.1);
    expect(result.state.releaseFloorRms).toBeCloseTo(0.05);
    expect(result.state.prevAttackPeak).toBeNull();
  });

  it('wraps back to the first token when the next note after the last matches a different pitch', () => {
    // At index 2 (midi 73), next wraps to index 0 (midi 72) — different pitch,
    // so a single frame of midi 72 should advance via the legato/different-pitch path.
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
    expect(result.state.activeTokenIndex).toBe(0);
    expect(result.state.waitingForRelease).toBe(true);
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
      state: midNoteState(1, 0.02),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(result.state.waitingForRelease).toBe(false);
    expect(result.state.prevAttackPeak).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Regression tests for the three bugs the rewrite addresses.
  // -------------------------------------------------------------------------

  it('Bug 4 regression: a quieter second attack still advances', () => {
    // Old algorithm tied recovery to lastAmplitudeReleaseRms / ratio, which
    // equals the previous peak. So a second attack quieter than the first
    // would never advance, regardless of slider position. The fix decouples
    // recovery (RECOVERY_ATTACK_RATIO = 0.5 of prev peak) from the slider.
    let state: TransposerFollowState = midNoteState(1, 0.20);

    const releaseFrame = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.05, // drops below 0.20 * 0.4 → release
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(releaseFrame.state.waitingForRelease).toBe(false);
    expect(releaseFrame.state.prevAttackPeak).toBeCloseTo(0.20);
    state = releaseFrame.state;

    // Second attack at peak 0.12 — less than the first attack's 0.20 peak,
    // but still above 0.20 * 0.5 = 0.10 recovery threshold.
    const quieterAttack = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(73),
        confidence: 0.8,
        rms: 0.12,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(quieterAttack.status).toBe('advanced');
    expect(quieterAttack.state.activeTokenIndex).toBe(2);
  });

  it('Bug 2 regression: three same-pitch attacks in a row each advance, even with pitch held', () => {
    // Old algorithm required matchingCurrent=false (pitch dropout) to fall
    // out of the waiting branch, and peakRmsSinceAdvance ratcheted up across
    // attacks. Players whose pitch detector held through breath gaps would
    // get stuck. The fix: peak/floor logic with the floor only tracking the
    // minimum since the *most recent* peak.
    const repeated = [
      { tokenIndex: 0, text: '4', midi: 72 },
      { tokenIndex: 1, text: '4', midi: 72 },
      { tokenIndex: 2, text: '4', midi: 72 },
    ];

    // Pre-arm at index 0 mid-note with a peak.
    let state: TransposerFollowState = midNoteState(0, 0.20);
    const freq = midiToFrequency(72);

    // Helper: feed one frame and return new state + status.
    function feed(rms: number) {
      const r = evaluateTransposerFollow({
        enabled: true,
        tokens: repeated,
        state,
        detector: createDetectorSnapshot({ frequency: freq, confidence: 0.8, rms }),
        toneToleranceCents: 10,
        minConfidence: 0.4,
      });
      state = r.state;
      return r;
    }

    // Note 1 ends — RMS dips, release fires, no advance yet.
    expect(feed(0.05).state.waitingForRelease).toBe(false);

    // Note 2 attack — exceeds recovery threshold, advance to index 1.
    expect(feed(0.18).state.activeTokenIndex).toBe(1);
    expect(feed(0.18).state.waitingForRelease).toBe(true);

    // Note 2 release — sustain peak then dip.
    expect(feed(0.22).state.peakRmsSinceAdvance).toBeCloseTo(0.22);
    expect(feed(0.06).state.waitingForRelease).toBe(false);

    // Note 3 attack — advance to index 2.
    expect(feed(0.18).state.activeTokenIndex).toBe(2);
  });

  it('Bug 3 regression: fresh state holds the first of a repeated-pitch run', () => {
    // Old algorithm: on a fresh state with lastAmplitudeReleaseRms === null,
    // the recovery check short-circuited true and the very first matched
    // frame on "4 4 ..." advanced to index 1, skipping the first '4'. Fix:
    // require prevAttackPeak !== null before allowing same-pitch advance.
    const repeated = [
      { tokenIndex: 0, text: '4', midi: 72 },
      { tokenIndex: 1, text: '4', midi: 72 },
    ];

    const firstFrame = evaluateTransposerFollow({
      enabled: true,
      tokens: repeated,
      state: createTransposerFollowState(0),
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
        rms: 0.15,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    // Cursor stays at 0 — we enter the waiting state at the current index
    // (Stage 4) instead of advancing.
    expect(firstFrame.state.activeTokenIndex).toBe(0);
    expect(firstFrame.state.waitingForRelease).toBe(true);
    expect(firstFrame.state.peakRmsSinceAdvance).toBeCloseTo(0.15);

    // After a release + new attack we do advance to index 1.
    const released = evaluateTransposerFollow({
      enabled: true,
      tokens: repeated,
      state: firstFrame.state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
        rms: 0.05,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(released.state.waitingForRelease).toBe(false);
    expect(released.state.activeTokenIndex).toBe(0);

    const reattacked = evaluateTransposerFollow({
      enabled: true,
      tokens: repeated,
      state: released.state,
      detector: createDetectorSnapshot({
        frequency: midiToFrequency(72),
        confidence: 0.8,
        rms: 0.12,
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });
    expect(reattacked.status).toBe('advanced');
    expect(reattacked.state.activeTokenIndex).toBe(1);
  });

  it('pitch dropout during sustain does not clear waitingForRelease without an amplitude dip', () => {
    // Originally a single non-matching frame inside the waiting branch
    // silently cleared waitingForRelease. The rewrite tracks release purely
    // by amplitude (no matchingCurrent requirement), so a brief detector
    // glitch with RMS still high keeps us in the waiting state.
    const state: TransposerFollowState = {
      activeTokenIndex: 1,
      waitingForRelease: true,
      peakRmsSinceAdvance: 0.20,
      releaseFloorRms: 0.20,
      prevAttackPeak: null,
    };

    const dropout = evaluateTransposerFollow({
      enabled: true,
      tokens: TOKENS,
      state,
      detector: createDetectorSnapshot({
        frequency: null, // detector lost pitch for one frame
        confidence: 0, // → matchingCurrent = false
        rms: 0.20, // but amplitude is still high
      }),
      toneToleranceCents: 10,
      minConfidence: 0.4,
    });

    expect(dropout.state.waitingForRelease).toBe(true);
    // peak and floor unchanged (no new max, no new min below floor).
    expect(dropout.state.peakRmsSinceAdvance).toBeCloseTo(0.20);
    expect(dropout.state.releaseFloorRms).toBeCloseTo(0.20);
  });

  it('slider monotonicity: a moderate dip releases at higher ratio but not at lower ratio', () => {
    // Frames: peak 0.20, then a dip to 0.10 (50% of peak). With ratio 0.7
    // the dip clears 0.20 * 0.7 = 0.14 → release. With ratio 0.4 the dip
    // doesn't clear 0.20 * 0.4 = 0.08 → still waiting. Old algorithm: the
    // slider had no observable effect at all.
    const dipFrame = createDetectorSnapshot({
      frequency: midiToFrequency(73),
      confidence: 0.8,
      rms: 0.10,
    });

    const lenient = evaluateTransposerFollowBase({
      enabled: true,
      tokens: TOKENS,
      state: midNoteState(1, 0.20),
      detector: dipFrame,
      toneToleranceCents: 10,
      minConfidence: 0.4,
      noteSeparationRatio: 0.7,
    });
    const strict = evaluateTransposerFollowBase({
      enabled: true,
      tokens: TOKENS,
      state: midNoteState(1, 0.20),
      detector: dipFrame,
      toneToleranceCents: 10,
      minConfidence: 0.4,
      noteSeparationRatio: 0.4,
    });

    // Lenient: release fires, and since the dip RMS (0.10) also meets the
    // recovery threshold (0.20 * 0.5 = 0.10), the same frame advances to the
    // next same-pitch token via Stage 3.
    expect(lenient.status).toBe('advanced');
    expect(lenient.state.activeTokenIndex).toBe(2);
    // Strict: release does NOT fire — cursor stays parked at index 1 and
    // prevAttackPeak stays null, so no recovery reference is recorded.
    expect(strict.state.waitingForRelease).toBe(true);
    expect(strict.state.activeTokenIndex).toBe(1);
    expect(strict.state.prevAttackPeak).toBeNull();
  });
});
