import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { createWebAudioPitchDetector } from '../logic/web-audio';
import { buildHarmonicaVocabulary } from '../logic/harmonica-frequencies';
import { createKeyDetector, KeyEstimate } from '../logic/key-detector';

/**
 * How long a Detect Key session listens before analysing. A few seconds gives
 * the chromagram enough harmonic content to settle on a key without making the
 * player wait too long mid-song.
 */
const DEFAULT_WINDOW_MS = 6000;
const PROGRESS_TICK_MS = 100;

export type KeyDetectionStatus = 'idle' | 'listening' | 'done' | 'error';

type Detector = ReturnType<typeof createWebAudioPitchDetector>;

/**
 * Picks the capture backend for key detection. Web uses Web Audio; iOS and
 * Android both use the native path, which delivers raw frames to JS. We
 * deliberately avoid the iOS WebView path (it can't expose frames here).
 */
function createFrameDetector(): Detector {
  if (Platform.OS === 'web') return createWebAudioPitchDetector();
  const { createNativeAudioPitchDetector } = require('../logic/native-audio');
  return createNativeAudioPitchDetector();
}

/**
 * Runs a fixed-window "Detect Key" session: captures audio, folds it into a
 * chromagram, and estimates the song's key. Independent of the note-follow
 * listening pipeline — the caller is responsible for stopping that first so a
 * single mic tap is active at a time.
 */
export function useKeyDetection(windowMs: number = DEFAULT_WINDOW_MS) {
  const [status, setStatus] = useState<KeyDetectionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<KeyEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detectorRef = useRef<Detector | null>(null);
  const keyDetectorRef = useRef<ReturnType<typeof createKeyDetector> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef(0);

  const teardown = useCallback(() => {
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    endTimerRef.current = null;
    progressTimerRef.current = null;
    detectorRef.current?.stop();
    detectorRef.current = null;
    keyDetectorRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    teardown();
    setStatus('idle');
    setProgress(0);
  }, [teardown]);

  const start = useCallback(async () => {
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    const isCurrent = () => sessionRef.current === session;

    teardown();
    setResult(null);
    setError(null);
    setProgress(0);
    setStatus('listening');

    // Native platforms need an explicit mic permission grant (web getUserMedia
    // prompts on its own).
    if (Platform.OS !== 'web') {
      try {
        const { Audio } = require('expo-av');
        const { granted } = await Audio.requestPermissionsAsync();
        if (!isCurrent()) return;
        if (!granted) {
          setError('Microphone permission denied');
          setStatus('error');
          return;
        }
      } catch {
        if (!isCurrent()) return;
      }
    }

    const keyDetector = createKeyDetector();
    keyDetectorRef.current = keyDetector;
    const detector = createFrameDetector();
    detectorRef.current = detector;

    if (!detector.isSupported()) {
      setError('Microphone not supported on this platform');
      setStatus('error');
      teardown();
      return;
    }

    // The pitch update is ignored — we only want the raw frames for the chroma.
    const vocabulary = buildHarmonicaVocabulary(0);
    try {
      await detector.start(
        () => {},
        vocabulary,
        (samples, sampleRate) => {
          if (!isCurrent()) return;
          keyDetectorRef.current?.pushFrame(samples, sampleRate);
        },
      );
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : 'Could not start microphone');
      setStatus('error');
      teardown();
      return;
    }
    if (!isCurrent()) return;

    const startedAt = Date.now();
    progressTimerRef.current = setInterval(() => {
      if (!isCurrent()) return;
      setProgress(Math.min(1, (Date.now() - startedAt) / windowMs));
    }, PROGRESS_TICK_MS);

    endTimerRef.current = setTimeout(() => {
      if (!isCurrent()) return;
      const estimate = keyDetectorRef.current?.analyze() ?? null;
      teardown();
      setProgress(1);
      setResult(estimate);
      setStatus('done');
    }, windowMs);
  }, [teardown, windowMs]);

  // Stop capture and timers if the component unmounts mid-session.
  useEffect(() => () => {
    sessionRef.current += 1;
    teardown();
  }, [teardown]);

  return { status, progress, result, error, start, cancel };
}
