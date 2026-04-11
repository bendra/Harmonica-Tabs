import { useState, useMemo } from 'react';

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

function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function useAudioSettings() {
  const [showDebug, setShowDebug] = useState(false);
  const [toneToleranceInput, setToneToleranceInput] = useState('60');
  const [toneFollowMinConfidenceInput, setToneFollowMinConfidenceInput] = useState('0.35');
  const [simFrequency, setSimFrequency] = useState('440');

  const toneToleranceCents = useMemo(
    () => parseBoundedNumber(toneToleranceInput, 60, 1, 120),
    [toneToleranceInput],
  );
  const toneFollowMinConfidence = useMemo(
    () => parseBoundedNumber(toneFollowMinConfidenceInput, 0.35, 0, 1),
    [toneFollowMinConfidenceInput],
  );
  const simHz = useMemo(() => {
    const parsed = Number.parseFloat(simFrequency);
    return Number.isFinite(parsed) ? parsed : null;
  }, [simFrequency]);

  return {
    showDebug,
    setShowDebug,
    toneToleranceInput,
    setToneToleranceInput: (value: string) => setToneToleranceInput(sanitizeDecimalInput(value)),
    toneFollowMinConfidenceInput,
    setToneFollowMinConfidenceInput: (value: string) =>
      setToneFollowMinConfidenceInput(sanitizeDecimalInput(value)),
    simFrequency,
    setSimFrequency,
    toneToleranceCents,
    toneFollowMinConfidence,
    simHz,
  };
}
