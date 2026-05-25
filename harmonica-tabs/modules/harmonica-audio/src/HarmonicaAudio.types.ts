import type { ViewProps } from 'react-native';

/**
 * Payload emitted by the native module for each audio frame.
 * Contains raw PCM samples; all detection runs in TypeScript.
 */
export type AudioFrameEventPayload = {
  /** Raw PCM samples as an array of floats in [-1, 1]. Length is always 4096. */
  samples: number[];
  /** Hardware sample rate in Hz (typically 44100 or 48000). */
  sampleRate: number;
  /** Capture timestamp (ms since epoch) for stale-frame filtering in JS. */
  capturedAt: number;
};

export type HarmonicaAudioModuleEvents = {
  onAudioFrame: (payload: AudioFrameEventPayload) => void;
};

export type WebViewPitchUpdatePayload = {
  frequency: number | null;
  rawFrequency: number | null;
  confidence: number;
  rms: number;
  candidates?: Array<{ frequency: number; confidence: number }>;
  yinDiagnostic?: unknown;
  trace?: Record<string, number | null>;
};

export type HarmonicaAudioViewProps = ViewProps & {
  url?: string;
  active?: boolean;
  vocabularyJson?: string;
  onLoad?: (event: { nativeEvent: { url?: string } }) => void;
  onWebViewDetectorReady?: (event: { nativeEvent: { supported?: boolean } }) => void;
  onWebViewDetectorError?: (event: { nativeEvent: { message?: string } }) => void;
  onWebViewPitchUpdate?: (event: { nativeEvent: WebViewPitchUpdatePayload }) => void;
};
