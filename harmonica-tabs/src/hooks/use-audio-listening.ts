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

/**
 * Temporal smoothing: how many recent frames to consider, and how many must
 * agree on the same MIDI note before we commit to reporting it.
 *
 * At ~10 frames/sec this is a ~500ms window with a 300ms minimum agreement
 * time — imperceptible latency for music practice, but enough to suppress
 * single-frame flips between adjacent notes.
 */
const SMOOTHING_WINDOW = 1;
const SMOOTHING_MIN_VOTES = 1;

/**
 * Given a ring buffer of recently detected frequencies (null = silence/no
 * detection), returns the frequency of the most-voted MIDI note if it reaches
 * the minimum vote count, or null otherwise.
 *
 * Comparison is by rounded MIDI number so that tiny frame-to-frame pitch drift
 * doesn't split votes between two bins for the same note.
 */
function smoothedFrequency(buffer: (number | null)[]): number | null {
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

type AudioListeningParams = {
  simHz: number | null;
  harmonicaPc: number;
  nativeFrameIntervalMs: number;
};

type AudioListeningState = {
  isListening: boolean;
  listenError: string | null;
  listenSource: 'web' | 'sim' | null;
  detectedFrequency: number | null;
  detectedRawFrequency: number | null;
  detectedConfidence: number;
  detectedRms: number;
  detectedCandidates: DetectionCandidate[];
  lastDetectedAt: number | null;
};

type AudioListeningValue = AudioListeningState & {
  audioSnapshot: DetectorSnapshot;
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
    detectedRawFrequency: null,
    detectedConfidence: 0,
    detectedRms: 0,
    detectedCandidates: [],
    lastDetectedAt: null,
  };
}

function createAudioListeningStore(initialParams: AudioListeningParams) {
  let params = initialParams;
  let state = createInitialState();
  let detector: ReturnType<typeof createWebAudioPitchDetector> | null = null;
  let isDisposed = false;
  let listenSession = 0;
  let smoothingBuffer: (number | null)[] = [];
  let snapshot: AudioListeningValue;
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function refreshSnapshot() {
    snapshot = {
      ...state,
      audioSnapshot: getAudioSnapshot(),
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
    setState({
      detectedFrequency: null,
      detectedRawFrequency: null,
      detectedConfidence: 0,
      detectedRms: 0,
      detectedCandidates: [],
      lastDetectedAt: null,
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

  function getAudioSnapshot(): DetectorSnapshot {
    const now = Date.now();
    const hasHold =
      state.lastDetectedAt !== null && now - state.lastDetectedAt < DEFAULT_AUDIO_SETTINGS.signalHoldMs;
    const effectiveWebFrequency =
      state.detectedConfidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate && state.detectedFrequency
        ? state.detectedFrequency
        : hasHold
          ? state.detectedFrequency
          : null;

    return {
      frequency: !state.isListening ? null : state.listenSource === 'web' ? effectiveWebFrequency : params.simHz,
      confidence: !state.isListening ? 0 : state.listenSource === 'web' ? state.detectedConfidence : params.simHz ? 1 : 0,
      rms: state.detectedRms,
      source: state.isListening ? state.listenSource : null,
      lastDetectedAt: state.lastDetectedAt,
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
    const frameIntervalChanged = params.nativeFrameIntervalMs !== nextParams.nativeFrameIntervalMs;
    params = nextParams;

    if (frameIntervalChanged) {
      (detector as { updateFrameIntervalMs?: (ms: number) => void } | null)
        ?.updateFrameIntervalMs?.(nextParams.nativeFrameIntervalMs);
    }

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
      detectedRawFrequency: null,
      detectedConfidence: 0,
      detectedRms: 0,
      detectedCandidates: [],
      lastDetectedAt: null,
    });
    smoothingBuffer = [];

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
          const nextCandidates = Array.isArray((update as { candidates?: DetectionCandidate[] }).candidates)
            ? (update as { candidates?: DetectionCandidate[] }).candidates ?? []
            : [];
          const nextRawFrequency =
            typeof (update as { rawFrequency?: number | null }).rawFrequency === 'number'
              ? (update as { rawFrequency?: number | null }).rawFrequency ?? null
              : null;
          setState({
            detectedFrequency: stable,
            detectedRawFrequency: nextRawFrequency,
            detectedConfidence: update.confidence,
            detectedRms: update.rms,
            detectedCandidates: nextCandidates,
            lastDetectedAt:
              stable && update.confidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate ? Date.now() : state.lastDetectedAt,
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
  nativeFrameIntervalMs,
  children,
}: AudioListeningParams & { children: React.ReactNode }) {
  const storeRef = useRef<AudioListeningStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createAudioListeningStore({ simHz, harmonicaPc, nativeFrameIntervalMs });
  }

  useEffect(() => {
    storeRef.current?.setParams({ simHz, harmonicaPc, nativeFrameIntervalMs });
  }, [simHz, harmonicaPc, nativeFrameIntervalMs]);

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
