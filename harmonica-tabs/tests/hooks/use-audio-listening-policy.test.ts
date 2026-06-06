import { describe, expect, it } from 'vitest';
import {
  createResponsiveCommitState,
  nextResponsiveFrequency,
  resolveAudioDetectorKind,
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

  it('responsive and stable paths both commit on the second consecutive new frame during a known transition', () => {
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
    expect(smoothedFrequency([c4, c4, c4, d4, d4])).toBeCloseTo(d4, 3);
  });

  it('stable fast-path does not fire when the last two frames disagree or include silence', () => {
    const c4 = midiToFrequency(60);
    const d4 = midiToFrequency(62);

    expect(smoothedFrequency([c4, c4, c4, c4, null])).toBeCloseTo(c4, 3);
    expect(smoothedFrequency([c4, c4, c4, d4, null])).toBeCloseTo(c4, 3);
    expect(smoothedFrequency([c4, c4, c4, null, d4])).toBeCloseTo(c4, 3);
  });

  it('stable fast-path stays inert during an attack from silence (no prior winner)', () => {
    const a4 = midiToFrequency(69);

    expect(smoothedFrequency([null, null, null, a4, a4])).toBeNull();
    expect(smoothedFrequency([null, null, a4, a4, a4])).toBeCloseTo(a4, 3);
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

  it('selects the WebView detector only for native platforms when the debug source is WebView', () => {
    expect(resolveAudioDetectorKind('web', 'webview')).toBe('web');
    expect(resolveAudioDetectorKind('ios', 'native')).toBe('native');
    expect(resolveAudioDetectorKind('ios', 'webview')).toBe('webview');
    expect(resolveAudioDetectorKind('android', 'webview')).toBe('native');
  });
});
