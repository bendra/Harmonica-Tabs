import { frequencyToMidi } from './pitch';

export type PitchUpdateTrace = {
  frameDurationMs: number | null;
  callbackAtMs: number;
  estimatedFrameStartAtMs: number | null;
  detectorStartAtMs: number | null;
  detectorEndAtMs: number | null;
  detectorDurationMs: number | null;
};

type LatencyEpisode = {
  frameStartAtMs: number | null;
  rawDetectedAtMs: number | null;
  snappedDetectedAtMs: number | null;
  stableDetectedAtMs: number | null;
  stableUiCommittedAtMs: number | null;
  responsiveDetectedAtMs: number | null;
  responsiveUiCommittedAtMs: number | null;
  tunerBaselineAtMs: number | null;
  committedNoteName: string | null;
  lastTunerCandidate: string | null;
  lastTunerCandidateCount: number;
};

export type LatencyMetrics = {
  captureToRawMs: number | null;
  rawToSnappedMs: number | null;
  snappedToSmoothedMs: number | null;
  smoothedToUiMs: number | null;
  captureToUiMs: number | null;
  captureToTunerBaselineMs: number | null;
  gapVsTunerBaselineMs: number | null;
};

export type LatencySnapshot = {
  stableCurrent: LatencyMetrics;
  stableAverages: LatencyMetrics;
  responsiveCurrent: LatencyMetrics;
  responsiveAverages: LatencyMetrics;
  frameDurationMs: number | null;
  detectorDurationMs: number | null;
  smoothingWindowLabels: string[];
  smoothingVotes: number;
  smoothingMinVotes: number;
  confidencePassed: boolean;
  rawLabel: string | null;
  snappedLabel: string | null;
  stableLabel: string | null;
  responsiveLabel: string | null;
  tunerBaselineLabel: string | null;
  completedEpisodeCount: number;
};

export type LatencyProfilerInput = {
  trace?: PitchUpdateTrace | null;
  rawFrequency: number | null;
  snappedFrequency: number | null;
  stableFrequency: number | null;
  responsiveFrequency: number | null;
  confidence: number;
  confidenceGate: number;
  smoothingWindow: (number | null)[];
  smoothingVotes: number;
  smoothingMinVotes: number;
};

const MAX_COMPLETED_EPISODES = 12;

function chromaticNoteName(frequency: number | null): string | null {
  if (frequency === null || !Number.isFinite(frequency)) return null;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(frequencyToMidi(frequency));
  return names[((midi % 12) + 12) % 12];
}

function formatNoteLabel(frequency: number | null): string | null {
  if (frequency === null || !Number.isFinite(frequency)) return null;
  const midi = Math.round(frequencyToMidi(frequency));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[((midi % 12) + 12) % 12]}${octave}`;
}

function durationOrNull(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

function computeMetrics(
  episode: LatencyEpisode,
  options: {
    committedAtMs: number | null;
    uiCommittedAtMs: number | null;
  },
): LatencyMetrics {
  const captureToRawMs = durationOrNull(episode.frameStartAtMs, episode.rawDetectedAtMs);
  const rawToSnappedMs = durationOrNull(episode.rawDetectedAtMs, episode.snappedDetectedAtMs);
  const snappedToSmoothedMs = durationOrNull(episode.snappedDetectedAtMs, options.committedAtMs);
  const smoothedToUiMs = durationOrNull(options.committedAtMs, options.uiCommittedAtMs);
  const captureToUiMs = durationOrNull(episode.frameStartAtMs, options.uiCommittedAtMs);
  const captureToTunerBaselineMs = durationOrNull(episode.frameStartAtMs, episode.tunerBaselineAtMs);
  return {
    captureToRawMs,
    rawToSnappedMs,
    snappedToSmoothedMs,
    smoothedToUiMs,
    captureToUiMs,
    captureToTunerBaselineMs,
    gapVsTunerBaselineMs:
      captureToUiMs !== null && captureToTunerBaselineMs !== null
        ? captureToUiMs - captureToTunerBaselineMs
        : null,
  };
}

function averageMetric(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value !== null);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function averageMetrics(
  history: LatencyEpisode[],
  options: (episode: LatencyEpisode) => { committedAtMs: number | null; uiCommittedAtMs: number | null },
): LatencyMetrics {
  const metrics = history.map((episode) => computeMetrics(episode, options(episode)));
  return {
    captureToRawMs: averageMetric(metrics.map((item) => item.captureToRawMs)),
    rawToSnappedMs: averageMetric(metrics.map((item) => item.rawToSnappedMs)),
    snappedToSmoothedMs: averageMetric(metrics.map((item) => item.snappedToSmoothedMs)),
    smoothedToUiMs: averageMetric(metrics.map((item) => item.smoothedToUiMs)),
    captureToUiMs: averageMetric(metrics.map((item) => item.captureToUiMs)),
    captureToTunerBaselineMs: averageMetric(metrics.map((item) => item.captureToTunerBaselineMs)),
    gapVsTunerBaselineMs: averageMetric(metrics.map((item) => item.gapVsTunerBaselineMs)),
  };
}

function createEpisode(startAtMs: number | null): LatencyEpisode {
  return {
    frameStartAtMs: startAtMs,
    rawDetectedAtMs: null,
    snappedDetectedAtMs: null,
    stableDetectedAtMs: null,
    stableUiCommittedAtMs: null,
    responsiveDetectedAtMs: null,
    responsiveUiCommittedAtMs: null,
    tunerBaselineAtMs: null,
    committedNoteName: null,
    lastTunerCandidate: null,
    lastTunerCandidateCount: 0,
  };
}

function hasSignal(input: LatencyProfilerInput): boolean {
  return (
    input.rawFrequency !== null ||
    input.snappedFrequency !== null ||
    input.stableFrequency !== null ||
    input.responsiveFrequency !== null
  );
}

function hasMeaningfulEpisode(episode: LatencyEpisode): boolean {
  const stableMetrics = computeMetrics(episode, {
    committedAtMs: episode.stableDetectedAtMs,
    uiCommittedAtMs: episode.stableUiCommittedAtMs,
  });
  const responsiveMetrics = computeMetrics(episode, {
    committedAtMs: episode.responsiveDetectedAtMs,
    uiCommittedAtMs: episode.responsiveUiCommittedAtMs,
  });
  return [...Object.values(stableMetrics), ...Object.values(responsiveMetrics)].some((value) => value !== null);
}

export function createLatencyProfiler() {
  let activeEpisode: LatencyEpisode | null = null;
  let completedEpisodes: LatencyEpisode[] = [];
  let snapshot: LatencySnapshot = {
    stableCurrent: {
      captureToRawMs: null,
      rawToSnappedMs: null,
      snappedToSmoothedMs: null,
      smoothedToUiMs: null,
      captureToUiMs: null,
      captureToTunerBaselineMs: null,
      gapVsTunerBaselineMs: null,
    },
    stableAverages: {
      captureToRawMs: null,
      rawToSnappedMs: null,
      snappedToSmoothedMs: null,
      smoothedToUiMs: null,
      captureToUiMs: null,
      captureToTunerBaselineMs: null,
      gapVsTunerBaselineMs: null,
    },
    responsiveCurrent: {
      captureToRawMs: null,
      rawToSnappedMs: null,
      snappedToSmoothedMs: null,
      smoothedToUiMs: null,
      captureToUiMs: null,
      captureToTunerBaselineMs: null,
      gapVsTunerBaselineMs: null,
    },
    responsiveAverages: {
      captureToRawMs: null,
      rawToSnappedMs: null,
      snappedToSmoothedMs: null,
      smoothedToUiMs: null,
      captureToUiMs: null,
      captureToTunerBaselineMs: null,
      gapVsTunerBaselineMs: null,
    },
    frameDurationMs: null,
    detectorDurationMs: null,
    smoothingWindowLabels: [],
    smoothingVotes: 0,
    smoothingMinVotes: 0,
    confidencePassed: false,
    rawLabel: null,
    snappedLabel: null,
    stableLabel: null,
    responsiveLabel: null,
    tunerBaselineLabel: null,
    completedEpisodeCount: 0,
  };

  function finalizeActiveEpisode() {
    if (!activeEpisode || !hasMeaningfulEpisode(activeEpisode)) return;
    completedEpisodes = [...completedEpisodes, activeEpisode].slice(-MAX_COMPLETED_EPISODES);
  }

  function reset() {
    activeEpisode = null;
    completedEpisodes = [];
    snapshot = {
      ...snapshot,
      stableCurrent: {
        captureToRawMs: null,
        rawToSnappedMs: null,
        snappedToSmoothedMs: null,
        smoothedToUiMs: null,
        captureToUiMs: null,
        captureToTunerBaselineMs: null,
        gapVsTunerBaselineMs: null,
      },
      stableAverages: {
        captureToRawMs: null,
        rawToSnappedMs: null,
        snappedToSmoothedMs: null,
        smoothedToUiMs: null,
        captureToUiMs: null,
        captureToTunerBaselineMs: null,
        gapVsTunerBaselineMs: null,
      },
      responsiveCurrent: {
        captureToRawMs: null,
        rawToSnappedMs: null,
        snappedToSmoothedMs: null,
        smoothedToUiMs: null,
        captureToUiMs: null,
        captureToTunerBaselineMs: null,
        gapVsTunerBaselineMs: null,
      },
      responsiveAverages: {
        captureToRawMs: null,
        rawToSnappedMs: null,
        snappedToSmoothedMs: null,
        smoothedToUiMs: null,
        captureToUiMs: null,
        captureToTunerBaselineMs: null,
        gapVsTunerBaselineMs: null,
      },
      frameDurationMs: null,
      detectorDurationMs: null,
      smoothingWindowLabels: [],
      smoothingVotes: 0,
      smoothingMinVotes: 0,
      confidencePassed: false,
      rawLabel: null,
      snappedLabel: null,
      stableLabel: null,
      responsiveLabel: null,
      tunerBaselineLabel: null,
      completedEpisodeCount: 0,
    };
  }

  function update(input: LatencyProfilerInput): LatencySnapshot {
    const signalPresent = hasSignal(input);
    const startAtMs = input.trace?.estimatedFrameStartAtMs ?? input.trace?.callbackAtMs ?? null;
    const rawNoteName = chromaticNoteName(input.rawFrequency ?? input.snappedFrequency);
    const candidateNoteName = chromaticNoteName(input.snappedFrequency ?? input.rawFrequency);
    const stableNoteName = chromaticNoteName(input.stableFrequency);
    const responsiveNoteName = chromaticNoteName(input.responsiveFrequency);
    const confidencePassed = input.snappedFrequency !== null && input.confidence >= input.confidenceGate;
    const stageAtMs = input.trace?.detectorEndAtMs ?? input.trace?.callbackAtMs ?? null;

    if (!signalPresent) {
      finalizeActiveEpisode();
      activeEpisode = null;
    } else {
      const shouldStartNewEpisode =
        activeEpisode === null ||
        ((activeEpisode.stableUiCommittedAtMs !== null || activeEpisode.responsiveUiCommittedAtMs !== null) &&
          candidateNoteName !== null &&
          activeEpisode.committedNoteName !== null &&
          candidateNoteName !== activeEpisode.committedNoteName);

      if (shouldStartNewEpisode) {
        finalizeActiveEpisode();
        activeEpisode = createEpisode(startAtMs);
      }

      if (activeEpisode) {
        if (activeEpisode.frameStartAtMs === null) {
          activeEpisode.frameStartAtMs = startAtMs;
        }

        if (input.rawFrequency !== null && activeEpisode.rawDetectedAtMs === null) {
          activeEpisode.rawDetectedAtMs = stageAtMs;
        }

        if (input.snappedFrequency !== null && activeEpisode.snappedDetectedAtMs === null) {
          activeEpisode.snappedDetectedAtMs = stageAtMs;
        }

        if (input.stableFrequency !== null && activeEpisode.stableDetectedAtMs === null) {
          activeEpisode.stableDetectedAtMs = stageAtMs;
        }

        if (input.responsiveFrequency !== null && activeEpisode.responsiveDetectedAtMs === null) {
          activeEpisode.responsiveDetectedAtMs = stageAtMs;
        }

        if (rawNoteName === null) {
          activeEpisode.lastTunerCandidate = null;
          activeEpisode.lastTunerCandidateCount = 0;
        } else if (rawNoteName === activeEpisode.lastTunerCandidate) {
          activeEpisode.lastTunerCandidateCount += 1;
        } else {
          activeEpisode.lastTunerCandidate = rawNoteName;
          activeEpisode.lastTunerCandidateCount = 1;
        }

        if (
          activeEpisode.tunerBaselineAtMs === null &&
          activeEpisode.lastTunerCandidateCount >= 2
        ) {
          activeEpisode.tunerBaselineAtMs = stageAtMs;
        }

        if (
          confidencePassed &&
          activeEpisode.stableUiCommittedAtMs === null &&
          input.stableFrequency !== null
        ) {
          activeEpisode.stableUiCommittedAtMs = stageAtMs;
          activeEpisode.committedNoteName = stableNoteName;
        }

        if (
          confidencePassed &&
          activeEpisode.responsiveUiCommittedAtMs === null &&
          input.responsiveFrequency !== null
        ) {
          activeEpisode.responsiveUiCommittedAtMs = stageAtMs;
          activeEpisode.committedNoteName = responsiveNoteName;
        }
      }
    }

    snapshot = {
      stableCurrent:
        activeEpisode
          ? computeMetrics(activeEpisode, {
              committedAtMs: activeEpisode.stableDetectedAtMs,
              uiCommittedAtMs: activeEpisode.stableUiCommittedAtMs,
            })
          : snapshot.stableCurrent,
      stableAverages: averageMetrics(completedEpisodes, (episode) => ({
        committedAtMs: episode.stableDetectedAtMs,
        uiCommittedAtMs: episode.stableUiCommittedAtMs,
      })),
      responsiveCurrent:
        activeEpisode
          ? computeMetrics(activeEpisode, {
              committedAtMs: activeEpisode.responsiveDetectedAtMs,
              uiCommittedAtMs: activeEpisode.responsiveUiCommittedAtMs,
            })
          : snapshot.responsiveCurrent,
      responsiveAverages: averageMetrics(completedEpisodes, (episode) => ({
        committedAtMs: episode.responsiveDetectedAtMs,
        uiCommittedAtMs: episode.responsiveUiCommittedAtMs,
      })),
      frameDurationMs: input.trace?.frameDurationMs ?? snapshot.frameDurationMs,
      detectorDurationMs: input.trace?.detectorDurationMs ?? snapshot.detectorDurationMs,
      smoothingWindowLabels: input.smoothingWindow.map((frequency) => formatNoteLabel(frequency) ?? '—'),
      smoothingVotes: input.smoothingVotes,
      smoothingMinVotes: input.smoothingMinVotes,
      confidencePassed,
      rawLabel: formatNoteLabel(input.rawFrequency),
      snappedLabel: formatNoteLabel(input.snappedFrequency),
      stableLabel: formatNoteLabel(input.stableFrequency),
      responsiveLabel: formatNoteLabel(input.responsiveFrequency),
      tunerBaselineLabel: activeEpisode?.lastTunerCandidate ?? null,
      completedEpisodeCount: completedEpisodes.length,
    };

    return snapshot;
  }

  function getSnapshot() {
    return snapshot;
  }

  return {
    update,
    getSnapshot,
    reset,
  };
}
