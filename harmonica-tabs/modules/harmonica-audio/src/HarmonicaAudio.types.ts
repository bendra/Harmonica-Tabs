/**
 * Payload emitted by the native module for each audio frame processed.
 * Shape matches PitchUpdate in web-audio.ts so both paths feed the same interface.
 */
export type AudioFrameEventPayload = {
  /** Frequency of the detected note in Hz, or null if no note detected above threshold. */
  frequency: number | null;
  /** 0–1: winner's share of total Goertzel energy across all candidate notes. */
  confidence: number;
  /** Root-mean-square energy of the audio frame. */
  rms: number;
};

export type HarmonicaAudioModuleEvents = {
  onAudioFrame: (payload: AudioFrameEventPayload) => void;
};
