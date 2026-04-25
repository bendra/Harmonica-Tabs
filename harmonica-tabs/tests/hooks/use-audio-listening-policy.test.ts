import { describe, expect, it } from 'vitest';
import {
  createResponsiveCommitState,
  nextResponsiveFrequency,
  smoothedFrequency,
} from '../../src/hooks/use-audio-listening';
import { midiToFrequency } from '../../src/logic/pitch';

describe('audio listening commit policies', () => {
  it('stable smoothing still requires 3 matching frames inside the 5-frame window', () => {
    const c4 = midiToFrequency(60);
    const d4 = midiToFrequency(62);

    expect(smoothedFrequency([c4, d4, c4, null, null])).toBeNull();
    expect(smoothedFrequency([c4, d4, c4, c4, null])).toBeCloseTo(c4, 3);
  });

  it('responsive path commits only after 2 consecutive snapped frames', () => {
    const d4 = midiToFrequency(62);
    let state = createResponsiveCommitState();

    const firstFrame = nextResponsiveFrequency(state, d4, 0.9, 0.2);
    state = firstFrame.nextState;
    expect(firstFrame.frequency).toBeNull();

    const secondFrame = nextResponsiveFrequency(state, d4, 0.9, 0.2);
    expect(secondFrame.frequency).toBeCloseTo(d4, 3);
  });

  it('responsive path switches faster than the stable path during a C-to-D transition', () => {
    const c4 = midiToFrequency(60);
    const d4 = midiToFrequency(62);
    let state = createResponsiveCommitState();

    state = nextResponsiveFrequency(state, c4, 0.9, 0.2).nextState;
    state = nextResponsiveFrequency(state, c4, 0.9, 0.2).nextState;

    const firstD = nextResponsiveFrequency(state, d4, 0.9, 0.2);
    expect(firstD.frequency).toBeCloseTo(c4, 3);

    const secondD = nextResponsiveFrequency(firstD.nextState, d4, 0.9, 0.2);
    expect(secondD.frequency).toBeCloseTo(d4, 3);

    expect(smoothedFrequency([c4, c4, c4, c4, d4])).toBeCloseTo(c4, 3);
    expect(smoothedFrequency([c4, c4, c4, d4, d4])).toBeCloseTo(c4, 3);
  });

  it('responsive path drops immediately when confidence or signal is lost', () => {
    const d4 = midiToFrequency(62);
    let state = createResponsiveCommitState();
    state = nextResponsiveFrequency(state, d4, 0.9, 0.2).nextState;
    state = nextResponsiveFrequency(state, d4, 0.9, 0.2).nextState;

    const lowConfidence = nextResponsiveFrequency(state, d4, 0.1, 0.2);
    expect(lowConfidence.frequency).toBeNull();

    const noSignal = nextResponsiveFrequency(state, null, 0.9, 0.2);
    expect(noSignal.frequency).toBeNull();
  });
});
