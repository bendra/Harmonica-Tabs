import { NativeModule, requireNativeModule } from 'expo';

import { HarmonicaAudioModuleEvents } from './HarmonicaAudio.types';

declare class HarmonicaAudioModule extends NativeModule<HarmonicaAudioModuleEvents> {
  /**
   * Starts microphone capture. Returns the hardware sample rate so the JS
   * pitch detector can use it. All detection logic runs in TypeScript.
   */
  start(): Promise<{ sampleRate: number }>;

  /** Stops capture and releases audio resources. */
  stop(): void;
}

export default requireNativeModule<HarmonicaAudioModule>('HarmonicaAudio');
