import { describe, expect, it } from 'vitest';
import { createLatencyProfiler } from '../../src/logic/audio-latency';

function trace(frameStartAtMs: number, detectorEndAtMs: number, frameDurationMs = 93) {
  return {
    frameDurationMs,
    callbackAtMs: frameStartAtMs + frameDurationMs,
    estimatedFrameStartAtMs: frameStartAtMs,
    detectorStartAtMs: detectorEndAtMs - 4,
    detectorEndAtMs,
    detectorDurationMs: 4,
  };
}

describe('createLatencyProfiler', () => {
  it('tracks per-stage latency through raw, snapped, smoothed, and UI commit', () => {
    const profiler = createLatencyProfiler();

    profiler.update({
      trace: trace(0, 93),
      rawFrequency: 440,
      snappedFrequency: 440,
      stableFrequency: null,
      responsiveFrequency: null,
      confidence: 0.9,
      confidenceGate: 0.2,
      smoothingWindow: [440],
      smoothingVotes: 1,
      smoothingMinVotes: 3,
    });

    profiler.update({
      trace: trace(93, 186),
      rawFrequency: 440,
      snappedFrequency: 440,
      stableFrequency: null,
      responsiveFrequency: 440,
      confidence: 0.9,
      confidenceGate: 0.2,
      smoothingWindow: [440, 440],
      smoothingVotes: 2,
      smoothingMinVotes: 3,
    });

    const snapshot = profiler.update({
      trace: trace(186, 279),
      rawFrequency: 440,
      snappedFrequency: 440,
      stableFrequency: 440,
      responsiveFrequency: 440,
      confidence: 0.9,
      confidenceGate: 0.2,
      smoothingWindow: [440, 440, 440],
      smoothingVotes: 3,
      smoothingMinVotes: 3,
    });

    expect(snapshot.stableCurrent.captureToRawMs).toBe(93);
    expect(snapshot.stableCurrent.rawToSnappedMs).toBe(0);
    expect(snapshot.stableCurrent.snappedToSmoothedMs).toBe(186);
    expect(snapshot.stableCurrent.smoothedToUiMs).toBe(0);
    expect(snapshot.stableCurrent.captureToUiMs).toBe(279);
    expect(snapshot.stableCurrent.captureToTunerBaselineMs).toBe(186);
    expect(snapshot.stableCurrent.gapVsTunerBaselineMs).toBe(93);
    expect(snapshot.responsiveCurrent.captureToUiMs).toBe(186);
    expect(snapshot.tunerBaselineLabel).toBe('A');
    expect(snapshot.stableLabel).toBe('A4');
    expect(snapshot.responsiveLabel).toBe('A4');
  });

  it('finalizes completed episodes into rolling averages after signal drops', () => {
    const profiler = createLatencyProfiler();

    profiler.update({
      trace: trace(0, 100),
      rawFrequency: 440,
      snappedFrequency: 440,
      stableFrequency: null,
      responsiveFrequency: null,
      confidence: 0.8,
      confidenceGate: 0.2,
      smoothingWindow: [440],
      smoothingVotes: 1,
      smoothingMinVotes: 3,
    });
    profiler.update({
      trace: trace(100, 200),
      rawFrequency: 440,
      snappedFrequency: 440,
      stableFrequency: 440,
      responsiveFrequency: 440,
      confidence: 0.8,
      confidenceGate: 0.2,
      smoothingWindow: [440, 440, 440],
      smoothingVotes: 3,
      smoothingMinVotes: 3,
    });
    profiler.update({
      trace: trace(200, 300),
      rawFrequency: null,
      snappedFrequency: null,
      stableFrequency: null,
      responsiveFrequency: null,
      confidence: 0,
      confidenceGate: 0.2,
      smoothingWindow: [],
      smoothingVotes: 0,
      smoothingMinVotes: 3,
    });

    const snapshot = profiler.update({
      trace: trace(300, 400),
      rawFrequency: 523.25,
      snappedFrequency: 523.25,
      stableFrequency: 523.25,
      responsiveFrequency: 523.25,
      confidence: 0.9,
      confidenceGate: 0.2,
      smoothingWindow: [523.25, 523.25, 523.25],
      smoothingVotes: 3,
      smoothingMinVotes: 3,
    });

    expect(snapshot.completedEpisodeCount).toBe(1);
    expect(snapshot.stableAverages.captureToUiMs).toBe(200);
    expect(snapshot.stableAverages.captureToTunerBaselineMs).toBe(200);
    expect(snapshot.responsiveAverages.captureToUiMs).toBe(200);
  });
});
