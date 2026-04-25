import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Platform } from 'react-native';
import { DetectorSnapshot } from '../logic/transposer-follow';
import { DetectionCandidate } from '../logic/fft-detector';
import { createWebAudioPitchDetector } from '../logic/web-audio';
import { buildHarmonicaVocabulary } from '../logic/harmonica-frequencies';
import { frequencyToMidi } from '../logic/pitch';
import { DEFAULT_AUDIO_SETTINGS } from '../config/default-settings';
import { createLatencyProfiler, LatencySnapshot, PitchUpdateTrace } from '../logic/audio-latency';

/**
 * Temporal smoothing: how many recent frames to consider, and how many must
 * agree on the same MIDI note before we commit to reporting it.
 *
 * At ~10 frames/sec this is a ~500ms window with a 300ms minimum agreement
 * time — imperceptible latency for music practice, but enough to suppress
 * single-frame flips between adjacent notes.
 */
const SMOOTHING_WINDOW = 5;
const SMOOTHING_MIN_VOTES = 3;
const RESPONSIVE_MIN_CONSECUTIVE_FRAMES = 2;

/**
 * Given a ring buffer of recently detected frequencies (null = silence/no
 * detection), returns the frequency of the most-voted MIDI note if it reaches
 * the minimum vote count, or null otherwise.
 *
 * Comparison is by rounded MIDI number so that tiny frame-to-frame pitch drift
 * doesn't split votes between two bins for the same note.
 */
export function smoothedFrequency(buffer: (number | null)[]): number | null {
  const freqsByMidi = new Map<number, number[]>();
  for (const freq of buffer) {
    if (freq === null) continue;
    const midi = Math.round(frequencyToMidi(freq));
    if (!freqsByMidi.has(midi)) freqsByMidi.set(midi, []);
    freqsByMidi.get(midi)!.push(freq);
  }

  let bestFreqs: number[] = [];
  for (const freqs of freqsByMidi.values()) {
    if (freqs.length > bestFreqs.length) bestFreqs = freqs;
  }

  if (bestFreqs.length < SMOOTHING_MIN_VOTES) return null;
  return bestFreqs[bestFreqs.length - 1];
}

function smoothingVoteCount(buffer: (number | null)[]): number {
  const votesByMidi = new Map<number, number>();
  for (const freq of buffer) {
    if (freq === null) continue;
    const midi = Math.round(frequencyToMidi(freq));
    votesByMidi.set(midi, (votesByMidi.get(midi) ?? 0) + 1);
  }

  let bestVotes = 0;
  for (const votes of votesByMidi.values()) {
    if (votes > bestVotes) bestVotes = votes;
  }
  return bestVotes;
}

function roundedMidi(frequency: number | null): number | null {
  if (frequency === null || !Number.isFinite(frequency)) return null;
  return Math.round(frequencyToMidi(frequency));
}

type ResponsiveCommitState = {
  candidateMidi: number | null;
  consecutiveFrames: number;
  committedFrequency: number | null;
};

export function createResponsiveCommitState(): ResponsiveCommitState {
  return {
    candidateMidi: null,
    consecutiveFrames: 0,
    committedFrequency: null,
  };
}

export function nextResponsiveFrequency(
  state: ResponsiveCommitState,
  snappedFrequency: number | null,
  confidence: number,
  confidenceGate: number,
) {
  const snappedMidi = roundedMidi(snappedFrequency);
  if (snappedMidi === null || confidence < confidenceGate) {
    return {
      nextState: createResponsiveCommitState(),
      frequency: null,
    };
  }

  const consecutiveFrames =
    snappedMidi === state.candidateMidi ? state.consecutiveFrames + 1 : 1;
  const committedMidi = roundedMidi(state.committedFrequency);
  const frequency =
    consecutiveFrames >= RESPONSIVE_MIN_CONSECUTIVE_FRAMES
      ? snappedFrequency
      : committedMidi === snappedMidi
        ? snappedFrequency
        : state.committedFrequency;

  return {
    nextState: {
      candidateMidi: snappedMidi,
      consecutiveFrames,
      committedFrequency: frequency,
    },
    frequency,
  };
}

type AudioListeningParams = {
  simHz: number | null;
  harmonicaPc: number;
};

type AudioListeningState = {
  isListening: boolean;
  listenError: string | null;
  listenSource: 'web' | 'sim' | null;
  detectedFrequency: number | null;
  detectedStableFrequency: number | null;
  detectedResponsiveFrequency: number | null;
  detectedSnappedFrequency: number | null;
  detectedRawFrequency: number | null;
  detectedConfidence: number;
  detectedRms: number;
  detectedCandidates: DetectionCandidate[];
  lastDetectedAt: number | null;
  lastStableDetectedAt: number | null;
  lastResponsiveDetectedAt: number | null;
};

type AudioListeningValue = AudioListeningState & {
  audioSnapshot: DetectorSnapshot;
  stableAudioSnapshot: DetectorSnapshot;
  responsiveAudioSnapshot: DetectorSnapshot;
  latencySnapshot: LatencySnapshot | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
};

type AudioListeningStore = ReturnType<typeof createAudioListeningStore>;

const AudioListeningContext = createContext<AudioListeningStore | null>(null);

function createInitialState(): AudioListeningState {
  return {
    isListening: false,
    listenError: null,
    listenSource: null,
    detectedFrequency: null,
    detectedStableFrequency: null,
    detectedResponsiveFrequency: null,
    detectedSnappedFrequency: null,
    detectedRawFrequency: null,
    detectedConfidence: 0,
    detectedRms: 0,
    detectedCandidates: [],
    lastDetectedAt: null,
    lastStableDetectedAt: null,
    lastResponsiveDetectedAt: null,
  };
}

function createAudioListeningStore(initialParams: AudioListeningParams) {
  let params = initialParams;
  let state = createInitialState();
  let detector: ReturnType<typeof createWebAudioPitchDetector> | null = null;
  let isDisposed = false;
  let listenSession = 0;
  let smoothingBuffer: (number | null)[] = [];
  let responsiveCommitState = createResponsiveCommitState();
  let latencyProfiler = createLatencyProfiler();
  let latencySnapshot: LatencySnapshot | null = latencyProfiler.getSnapshot();
  let snapshot: AudioListeningValue;
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function refreshSnapshot() {
    const stableAudioSnapshot = getAudioSnapshot('stable');
    const responsiveAudioSnapshot = getAudioSnapshot('responsive');
    snapshot = {
      ...state,
      audioSnapshot: stableAudioSnapshot,
      stableAudioSnapshot,
      responsiveAudioSnapshot,
      latencySnapshot,
      startListening,
      stopListening,
    };
  }

  function setState(updates: Partial<AudioListeningState>) {
    state = { ...state, ...updates };
    refreshSnapshot();
    emit();
  }

  function resetDetectionState() {
    latencyProfiler.reset();
    latencySnapshot = latencyProfiler.getSnapshot();
    setState({
      detectedFrequency: null,
      detectedStableFrequency: null,
      detectedResponsiveFrequency: null,
      detectedSnappedFrequency: null,
      detectedRawFrequency: null,
      detectedConfidence: 0,
      detectedRms: 0,
      detectedCandidates: [],
      lastDetectedAt: null,
      lastStableDetectedAt: null,
      lastResponsiveDetectedAt: null,
    });
  }

  function ensureDetector() {
    if (detector) return detector;
    if (Platform.OS === 'web') {
      detector = createWebAudioPitchDetector();
      return detector;
    }

    const { createNativeAudioPitchDetector } = require('../logic/native-audio');
    detector = createNativeAudioPitchDetector();
    return detector;
  }

  function getAudioSnapshot(path: 'stable' | 'responsive'): DetectorSnapshot {
    const now = Date.now();
    const isStablePath = path === 'stable';
    const detectedFrequency = isStablePath ? state.detectedStableFrequency : state.detectedResponsiveFrequency;
    const lastDetectedAt = isStablePath ? state.lastStableDetectedAt : state.lastResponsiveDetectedAt;
    const hasHold =
      isStablePath &&
      lastDetectedAt !== null &&
      now - lastDetectedAt < DEFAULT_AUDIO_SETTINGS.signalHoldMs;
    const effectiveWebFrequency =
      state.detectedConfidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate && detectedFrequency
        ? detectedFrequency
        : hasHold
          ? detectedFrequency
          : null;

    return {
      frequency: !state.isListening ? null : state.listenSource === 'web' ? effectiveWebFrequency : params.simHz,
      confidence: !state.isListening ? 0 : state.listenSource === 'web' ? state.detectedConfidence : params.simHz ? 1 : 0,
      rms: state.detectedRms,
      source: state.isListening ? state.listenSource : null,
      lastDetectedAt,
    };
  }

  function getSnapshot(): AudioListeningValue {
    return snapshot;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setParams(nextParams: AudioListeningParams) {
    const simHzChanged = params.simHz !== nextParams.simHz;
    const harmonicaChanged = params.harmonicaPc !== nextParams.harmonicaPc;
    params = nextParams;

    if (!state.isListening) return;
    if (state.listenSource === 'sim' && simHzChanged) {
      refreshSnapshot();
      emit();
      return;
    }

    if (state.listenSource === 'web' && harmonicaChanged) {
      const nextVocabulary = buildHarmonicaVocabulary(nextParams.harmonicaPc);
      (detector as { updateVocabulary?: (vocabulary: ReturnType<typeof buildHarmonicaVocabulary>) => void } | null)
        ?.updateVocabulary?.(nextVocabulary);
    }
  }

  async function startListening() {
    const currentListenSession = listenSession + 1;
    listenSession = currentListenSession;
    setState({
      isListening: state.isListening,
      listenError: null,
      detectedFrequency: null,
      detectedStableFrequency: null,
      detectedResponsiveFrequency: null,
      detectedSnappedFrequency: null,
      detectedRawFrequency: null,
      detectedConfidence: 0,
      detectedRms: 0,
      detectedCandidates: [],
      lastDetectedAt: null,
      lastStableDetectedAt: null,
      lastResponsiveDetectedAt: null,
    });
    smoothingBuffer = [];
    responsiveCommitState = createResponsiveCommitState();
    latencyProfiler.reset();
    latencySnapshot = latencyProfiler.getSnapshot();

    function isCurrentListenSession() {
      return !isDisposed && listenSession === currentListenSession;
    }

    if (Platform.OS !== 'web') {
      const { Audio } = require('expo-av');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        if (!isCurrentListenSession()) return;
        setState({
          isListening: true,
          listenError: 'Microphone permission denied',
          listenSource: 'sim',
        });
        return;
      }
    }

    const activeDetector = ensureDetector();
    const vocabulary = buildHarmonicaVocabulary(params.harmonicaPc);
    if (activeDetector?.isSupported()) {
      try {
        await activeDetector.start((update) => {
          if (!isCurrentListenSession()) return;

          const nextBuffer = [...smoothingBuffer, update.frequency];
          if (nextBuffer.length > SMOOTHING_WINDOW) {
            nextBuffer.shift();
          }
          smoothingBuffer = nextBuffer;

          const stable = smoothedFrequency(nextBuffer);
          const votes = smoothingVoteCount(nextBuffer);
          const responsiveCommit = nextResponsiveFrequency(
            responsiveCommitState,
            update.frequency,
            update.confidence,
            DEFAULT_AUDIO_SETTINGS.confidenceGate,
          );
          responsiveCommitState = responsiveCommit.nextState;
          const responsive = responsiveCommit.frequency;
          const nextCandidates = Array.isArray((update as { candidates?: DetectionCandidate[] }).candidates)
            ? (update as { candidates?: DetectionCandidate[] }).candidates ?? []
            : [];
          const nextRawFrequency =
            typeof (update as { rawFrequency?: number | null }).rawFrequency === 'number'
              ? (update as { rawFrequency?: number | null }).rawFrequency ?? null
              : null;
          const nextTrace =
            (update as { trace?: PitchUpdateTrace | null }).trace ?? null;
          latencySnapshot = latencyProfiler.update({
            trace: nextTrace,
            rawFrequency: nextRawFrequency,
            snappedFrequency: update.frequency,
            stableFrequency: stable,
            responsiveFrequency: responsive,
            confidence: update.confidence,
            confidenceGate: DEFAULT_AUDIO_SETTINGS.confidenceGate,
            smoothingWindow: nextBuffer,
            smoothingVotes: votes,
            smoothingMinVotes: SMOOTHING_MIN_VOTES,
          });
          setState({
            detectedFrequency: stable,
            detectedStableFrequency: stable,
            detectedResponsiveFrequency: responsive,
            detectedSnappedFrequency: update.frequency,
            detectedRawFrequency: nextRawFrequency,
            detectedConfidence: update.confidence,
            detectedRms: update.rms,
            detectedCandidates: nextCandidates,
            lastDetectedAt:
              stable && update.confidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate ? Date.now() : state.lastDetectedAt,
            lastStableDetectedAt:
              stable && update.confidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate
                ? Date.now()
                : state.lastStableDetectedAt,
            lastResponsiveDetectedAt:
              responsive && update.confidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate
                ? Date.now()
                : state.lastResponsiveDetectedAt,
          });
        }, vocabulary);
        if (!isCurrentListenSession()) return;
        setState({
          isListening: true,
          listenSource: 'web',
        });
      } catch {
        if (!isCurrentListenSession()) return;
        setState({
          isListening: true,
          listenError: 'Mic blocked or unavailable (using sim)',
          listenSource: 'sim',
        });
      }
    } else {
      if (!isCurrentListenSession()) return;
      setState({
        isListening: true,
        listenError: 'Mic not supported on this platform (using sim)',
        listenSource: 'sim',
      });
    }
  }

  function stopListening() {
    listenSession += 1;
    detector?.stop();
    smoothingBuffer = [];
    responsiveCommitState = createResponsiveCommitState();
    resetDetectionState();
    setState({
      isListening: false,
      listenSource: null,
    });
  }

  function dispose() {
    isDisposed = true;
    listenSession += 1;
    detector?.stop();
    latencyProfiler.reset();
    listeners.clear();
  }

  refreshSnapshot();

  return {
    subscribe,
    getSnapshot,
    setParams,
    dispose,
  };
}

export function AudioListeningProvider({
  simHz,
  harmonicaPc,
  children,
}: AudioListeningParams & { children: React.ReactNode }) {
  const storeRef = useRef<AudioListeningStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createAudioListeningStore({ simHz, harmonicaPc });
  }

  useEffect(() => {
    storeRef.current?.setParams({ simHz, harmonicaPc });
  }, [simHz, harmonicaPc]);

  useEffect(() => () => storeRef.current?.dispose(), []);

  return React.createElement(AudioListeningContext.Provider, { value: storeRef.current }, children);
}

export function useAudioListening() {
  const store = useContext(AudioListeningContext);
  if (!store) {
    throw new Error('useAudioListening must be used within AudioListeningProvider.');
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
