import { NativeModule, registerWebModule } from 'expo';

import { HarmonicaAudioModuleEvents } from './HarmonicaAudio.types';

/**
 * Web stub — the native audio module is not used on web.
 * useAudioListening selects web-audio.ts on Platform.OS === 'web'.
 */
class HarmonicaAudioModule extends NativeModule<HarmonicaAudioModuleEvents> {
  async start(_frequencies: number[], _thresholds: number[]): Promise<{ sampleRate: number }> {
    throw new Error('HarmonicaAudioModule is not available on web.');
  }
  stop(): void {}
}

export default registerWebModule(HarmonicaAudioModule, 'HarmonicaAudio');
