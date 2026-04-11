import HarmonicaAudioModule from '../../modules/harmonica-audio';
import { HarmonicaVocabulary } from './harmonica-frequencies';

type PitchUpdate = {
  frequency: number | null;
  confidence: number;
  rms: number;
};

type PitchUpdateHandler = (update: PitchUpdate) => void;

/**
 * Creates a native audio pitch detector with the same { isSupported, start, stop }
 * interface as createWebAudioPitchDetector() in web-audio.ts.
 *
 * On native, Goertzel detection runs in Swift/Kotlin and only the small result
 * (frequency, confidence, rms) is sent to JS — no raw PCM crosses the bridge.
 */
export function createNativeAudioPitchDetector() {
  let subscription: ReturnType<typeof HarmonicaAudioModule.addListener> | null = null;

  function isSupported(): boolean {
    // The native module is available whenever this file is imported on a native platform.
    // On web, HarmonicaAudioModule.web.ts is resolved instead and useAudioListening
    // never calls createNativeAudioPitchDetector(), so this always returns true here.
    return true;
  }

  async function start(onUpdate: PitchUpdateHandler, vocabulary: HarmonicaVocabulary) {
    // Pass the vocabulary's frequencies and thresholds to native so it knows
    // which notes to look for without needing to rebuild them in Swift/Kotlin.
    const frequencies = vocabulary.allNotes.map((n) => n.frequency);
    const thresholds = vocabulary.allNotes.map((n) => n.confidenceThreshold);

    // Subscribe before starting so no frames are missed.
    subscription = HarmonicaAudioModule.addListener('onAudioFrame', (event) => {
      onUpdate({
        frequency: event.frequency,
        confidence: event.confidence,
        rms: event.rms,
      });
    });

    await HarmonicaAudioModule.start(frequencies, thresholds);
  }

  function stop() {
    HarmonicaAudioModule.stop();
    subscription?.remove();
    subscription = null;
  }

  return { isSupported, start, stop };
}
