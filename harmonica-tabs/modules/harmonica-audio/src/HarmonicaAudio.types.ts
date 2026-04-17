/**
 * Payload emitted by the native module for each audio frame.
 * Contains raw PCM samples; all detection runs in TypeScript.
 */
export type AudioFrameEventPayload = {
  /** Raw PCM samples as an array of floats in [-1, 1]. Length is always 4096. */
  samples: number[];
  /** Hardware sample rate in Hz (typically 44100 or 48000). */
  sampleRate: number;
};

export type HarmonicaAudioModuleEvents = {
  onAudioFrame: (payload: AudioFrameEventPayload) => void;
};
