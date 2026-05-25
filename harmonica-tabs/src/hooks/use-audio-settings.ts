import { useState, useMemo } from 'react';
import { AUDIO_SETTINGS_LIMITS, DEFAULT_AUDIO_SETTINGS } from '../config/default-settings';

export type NativeAudioSource = 'native' | 'webview';

function sanitizeDecimalInput(value: string): string {
  let sawDot = false;
  let result = '';

  for (const char of value) {
    if (/[0-9]/.test(char)) {
      result += char;
      continue;
    }
    if (char === '.' && !sawDot) {
      sawDot = true;
      result += char;
    }
  }

  return result;
}

function parseBoundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export type AudioSettingsInitial = {
  showDebug?: boolean;
  nativeAudioSource?: NativeAudioSource;
  toneToleranceInput?: string;
  toneFollowMinConfidenceInput?: string;
  noteSeparationRatioInput?: string;
  minSendIntervalMsInput?: string;
  simFrequencyInput?: string;
};

export function useAudioSettings(initial: AudioSettingsInitial = {}) {
  const [showDebug, setShowDebug] = useState<boolean>(initial.showDebug ?? DEFAULT_AUDIO_SETTINGS.showDebug);
  const [nativeAudioSource, setNativeAudioSource] = useState<NativeAudioSource>(
    initial.nativeAudioSource ?? DEFAULT_AUDIO_SETTINGS.nativeAudioSource,
  );
  const [toneToleranceInput, setToneToleranceInput] = useState<string>(
    initial.toneToleranceInput ?? DEFAULT_AUDIO_SETTINGS.toneToleranceInput,
  );
  const [toneFollowMinConfidenceInput, setToneFollowMinConfidenceInput] = useState<string>(
    initial.toneFollowMinConfidenceInput ?? DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidenceInput,
  );
  const [noteSeparationRatioInput, setNoteSeparationRatioInput] = useState<string>(
    initial.noteSeparationRatioInput ?? DEFAULT_AUDIO_SETTINGS.noteSeparationRatioInput,
  );
  const [minSendIntervalMsInput, setMinSendIntervalMsInput] = useState<string>(
    initial.minSendIntervalMsInput ?? DEFAULT_AUDIO_SETTINGS.minSendIntervalMsInput,
  );
  const [simFrequency, setSimFrequency] = useState<string>(
    initial.simFrequencyInput ?? DEFAULT_AUDIO_SETTINGS.simFrequencyInput,
  );

  const toneToleranceCents = useMemo(
    () =>
      parseBoundedNumber(
        toneToleranceInput,
        DEFAULT_AUDIO_SETTINGS.toneToleranceCents,
        AUDIO_SETTINGS_LIMITS.toneToleranceCents.min,
        AUDIO_SETTINGS_LIMITS.toneToleranceCents.max,
      ),
    [toneToleranceInput],
  );
  const toneFollowMinConfidence = useMemo(
    () =>
      parseBoundedNumber(
        toneFollowMinConfidenceInput,
        DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence,
        AUDIO_SETTINGS_LIMITS.toneFollowMinConfidence.min,
        AUDIO_SETTINGS_LIMITS.toneFollowMinConfidence.max,
      ),
    [toneFollowMinConfidenceInput],
  );
  const noteSeparationRatio = useMemo(
    () =>
      parseBoundedNumber(
        noteSeparationRatioInput,
        DEFAULT_AUDIO_SETTINGS.noteSeparationRatio,
        AUDIO_SETTINGS_LIMITS.noteSeparationRatio.min,
        AUDIO_SETTINGS_LIMITS.noteSeparationRatio.max,
      ),
    [noteSeparationRatioInput],
  );
  const minSendIntervalMs = useMemo(
    () =>
      parseBoundedInteger(
        minSendIntervalMsInput,
        DEFAULT_AUDIO_SETTINGS.minSendIntervalMs,
        AUDIO_SETTINGS_LIMITS.minSendIntervalMs.min,
        AUDIO_SETTINGS_LIMITS.minSendIntervalMs.max,
      ),
    [minSendIntervalMsInput],
  );
  const simHz = useMemo(() => {
    const parsed = Number.parseFloat(simFrequency);
    return Number.isFinite(parsed) ? parsed : null;
  }, [simFrequency]);

  return {
    showDebug,
    setShowDebug,
    nativeAudioSource,
    setNativeAudioSource,
    toneToleranceInput,
    setToneToleranceInput: (value: string) => setToneToleranceInput(sanitizeDecimalInput(value)),
    toneFollowMinConfidenceInput,
    setToneFollowMinConfidenceInput: (value: string) =>
      setToneFollowMinConfidenceInput(sanitizeDecimalInput(value)),
    noteSeparationRatioInput,
    setNoteSeparationRatioInput: (value: string) =>
      setNoteSeparationRatioInput(sanitizeDecimalInput(value)),
    minSendIntervalMsInput,
    setMinSendIntervalMsInput: (value: string) =>
      setMinSendIntervalMsInput(sanitizeDecimalInput(value)),
    simFrequency,
    setSimFrequency,
    toneToleranceCents,
    toneFollowMinConfidence,
    noteSeparationRatio,
    minSendIntervalMs,
    simHz,
  };
}
