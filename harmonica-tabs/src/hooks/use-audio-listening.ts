import { useState, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { DetectorSnapshot } from '../logic/transposer-follow';
import { createWebAudioPitchDetector } from '../logic/web-audio';
import { buildHarmonicaVocabulary } from '../logic/harmonica-frequencies';

const AUDIO_SIGNAL_HOLD_MS = 400;
const AUDIO_CONFIDENCE_GATE = 0.2;

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
  const [lastDetectedAt, setLastDetectedAt] = useState<number | null>(null);

  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const isMountedRef = useRef(true);
  const listenSessionRef = useRef(0);

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
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);

    function isCurrentListenSession() {
      return isMountedRef.current && listenSessionRef.current === listenSession;
    }

    // On native, request microphone permission before attempting to start.
    // On web, getUserMedia handles the permission prompt itself.
    if (Platform.OS !== 'web') {
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
          setDetectedFrequency(update.frequency);
          setDetectedConfidence(update.confidence);
          setDetectedRms(update.rms);
          if (update.frequency && update.confidence >= AUDIO_CONFIDENCE_GATE) {
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
    setIsListening(false);
    setListenSource(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);
  }

  return {
    isListening,
    listenError,
    listenSource,
    detectedFrequency,
    detectedConfidence,
    detectedRms,
    lastDetectedAt,
    audioSnapshot,
    startListening,
    stopListening,
  };
}
