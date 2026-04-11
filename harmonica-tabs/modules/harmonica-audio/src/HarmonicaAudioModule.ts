import { NativeModule, requireNativeModule } from 'expo';

import { HarmonicaAudioModuleEvents } from './HarmonicaAudio.types';

declare class HarmonicaAudioModule extends NativeModule<HarmonicaAudioModuleEvents> {
  /**
   * Starts microphone capture and Goertzel pitch detection.
   *
   * @param frequencies - Target frequencies to score, in Hz (one per vocabulary note).
   * @param thresholds  - Minimum confidence threshold per frequency (same order).
   * @returns The actual sample rate the hardware is capturing at.
   */
  start(frequencies: number[], thresholds: number[]): Promise<{ sampleRate: number }>;

  /** Stops capture and releases audio resources. */
  stop(): void;
}

export default requireNativeModule<HarmonicaAudioModule>('HarmonicaAudio');
