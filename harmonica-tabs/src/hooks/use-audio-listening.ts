import { useState, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { DetectorSnapshot } from '../logic/transposer-follow';
import { DetectionCandidate } from '../logic/fft-detector';
import { createWebAudioPitchDetector } from '../logic/web-audio';
import { buildHarmonicaVocabulary } from '../logic/harmonica-frequencies';
import { frequencyToMidi } from '../logic/pitch';

const AUDIO_SIGNAL_HOLD_MS = 400;
const AUDIO_CONFIDENCE_GATE = 0.2;

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
  // Return the most recent frequency for the winning MIDI.
  return bestFreqs[bestFreqs.length - 1];
}

type AudioListeningParams = {
  simHz: number | null;
  harmonicaPc: number;
};

export function useAudioListening({ simHz, harmonicaPc }: AudioListeningParams) {
  const vocabulary = useMemo(() => buildHarmonicaVocabulary(harmonicaPc), [harmonicaPc]);
  const [isListening, setIsListening] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenSource, setListenSource] = useState<'web' | 'sim' | null>(null);
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null);
  const [detectedConfidence, setDetectedConfidence] = useState(0);
  const [detectedRms, setDetectedRms] = useState(0);
  const [detectedRawFrequency, setDetectedRawFrequency] = useState<number | null>(null);
  const [detectedCandidates, setDetectedCandidates] = useState<DetectionCandidate[]>([]);
  const [lastDetectedAt, setLastDetectedAt] = useState<number | null>(null);

  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const isMountedRef = useRef(true);
  const listenSessionRef = useRef(0);
  const smoothingBufferRef = useRef<(number | null)[]>([]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      detectorRef.current = createWebAudioPitchDetector();
    } else {
      // Dynamic require prevents the native module from being bundled on web.
      const { createNativeAudioPitchDetector } = require('../logic/native-audio');
      detectorRef.current = createNativeAudioPitchDetector();
    }
    return () => {
      isMountedRef.current = false;
      listenSessionRef.current += 1;
      detectorRef.current?.stop();
    };
  }, []);

  // When the harmonica key changes while listening is active, push the new
  // vocabulary to the detector immediately. Without this, the detector keeps
  // using the vocabulary from when Listen was first pressed, which means notes
  // below the original harmonica's frequency range are never searched for.
  useEffect(() => {
    if (!isListening) return;
    (detectorRef.current as any)?.updateVocabulary?.(vocabulary);
  }, [vocabulary, isListening]);

  const audioSnapshot = useMemo<DetectorSnapshot>(() => {
    const now = Date.now();
    const hasHold = lastDetectedAt !== null && now - lastDetectedAt < AUDIO_SIGNAL_HOLD_MS;
    const effectiveWebFrequency =
      detectedConfidence >= AUDIO_CONFIDENCE_GATE && detectedFrequency
        ? detectedFrequency
        : hasHold
          ? detectedFrequency
          : null;
    return {
      frequency: !isListening ? null : listenSource === 'web' ? effectiveWebFrequency : simHz,
      confidence: !isListening ? 0 : listenSource === 'web' ? detectedConfidence : simHz ? 1 : 0,
      rms: detectedRms,
      source: isListening ? listenSource : null,
      lastDetectedAt,
    };
  }, [detectedConfidence, detectedRms, detectedFrequency, isListening, lastDetectedAt, listenSource, simHz]);

  async function startListening() {
    const listenSession = listenSessionRef.current + 1;
    listenSessionRef.current = listenSession;
    setListenError(null);
    setDetectedFrequency(null);
    setDetectedRawFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setDetectedCandidates([]);
    setLastDetectedAt(null);
    smoothingBufferRef.current = [];

    function isCurrentListenSession() {
      return isMountedRef.current && listenSessionRef.current === listenSession;
    }

    // On native, request microphone permission before attempting to start.
    // On web, getUserMedia handles the permission prompt itself.
    if (Platform.OS !== 'web') {
      // Load expo-av only on native so web/tests do not need Expo's native runtime globals.
      const { Audio } = require('expo-av');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        if (!isCurrentListenSession()) return;
        setListenError('Microphone permission denied');
        setListenSource('sim');
        setIsListening(true);
        return;
      }
    }

    const detector = detectorRef.current;
    if (detector?.isSupported()) {
      try {
        await detector.start((update) => {
          if (!isCurrentListenSession()) return;

          // Push this frame's raw detection into the ring buffer and trim.
          const buf = smoothingBufferRef.current;
          buf.push(update.frequency);
          if (buf.length > SMOOTHING_WINDOW) buf.shift();

          // Only commit to a frequency once it has appeared consistently.
          const stable = smoothedFrequency(buf);

          setDetectedFrequency(stable);
          setDetectedConfidence(update.confidence);
          setDetectedRms(update.rms);
          if ('rawFrequency' in update) setDetectedRawFrequency((update as any).rawFrequency ?? null);
          if ('candidates' in update) setDetectedCandidates((update as any).candidates ?? []);
          if (stable && update.confidence >= AUDIO_CONFIDENCE_GATE) {
            setLastDetectedAt(Date.now());
          }
        }, vocabulary);
        if (!isCurrentListenSession()) return;
        setListenSource('web');
      } catch {
        if (!isCurrentListenSession()) return;
        setListenError('Mic blocked or unavailable (using sim)');
        setListenSource('sim');
      }
    } else {
      if (!isCurrentListenSession()) return;
      setListenError('Mic not supported on this platform (using sim)');
      setListenSource('sim');
    }

    if (!isCurrentListenSession()) return;
    setIsListening(true);
  }

  function stopListening() {
    listenSessionRef.current += 1;
    detectorRef.current?.stop();
    smoothingBufferRef.current = [];
    setIsListening(false);
    setListenSource(null);
    setDetectedFrequency(null);
    setDetectedRawFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setDetectedCandidates([]);
    setLastDetectedAt(null);
  }

  return {
    isListening,
    listenError,
    listenSource,
    detectedFrequency,
    detectedRawFrequency,
    detectedConfidence,
    detectedRms,
    detectedCandidates,
    lastDetectedAt,
    audioSnapshot,
    startListening,
    stopListening,
  };
}
