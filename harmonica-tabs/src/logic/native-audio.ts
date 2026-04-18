import HarmonicaAudioModule from '../../modules/harmonica-audio';
import { HarmonicaVocabulary } from './harmonica-frequencies';
import { detectSingleNote, SingleNoteResult } from './fft-detector';

type PitchUpdateHandler = (update: SingleNoteResult) => void;

/**
 * Creates a native audio pitch detector with the same { isSupported, start, stop }
 * interface as createWebAudioPitchDetector() in web-audio.ts.
 *
 * The native module captures raw PCM and emits 4096-sample frames. Detection runs
 * here in TypeScript using the same YIN-based detectSingleNote() as the web path —
 * no detection logic lives in Swift or Kotlin.
 */
export function createNativeAudioPitchDetector() {
  let subscription: ReturnType<typeof HarmonicaAudioModule.addListener> | null = null;
  let currentVocabulary: HarmonicaVocabulary | null = null;

  function isSupported(): boolean {
    return true;
  }

  async function start(onUpdate: PitchUpdateHandler, vocabulary: HarmonicaVocabulary) {
    currentVocabulary = vocabulary;
    // Subscribe before starting so no frames are missed.
    subscription = HarmonicaAudioModule.addListener('onAudioFrame', (event) => {
      if (!currentVocabulary) return;
      const samples = new Float32Array(event.samples);
      const result = detectSingleNote(samples, event.sampleRate, currentVocabulary);
      onUpdate(result);
    });

    const info = await HarmonicaAudioModule.start();
    console.log('[native-audio] started — sampleRate:', info?.sampleRate);
  }

  function stop() {
    HarmonicaAudioModule.stop();
    subscription?.remove();
    subscription = null;
    currentVocabulary = null;
  }

  function updateVocabulary(vocabulary: HarmonicaVocabulary) {
    currentVocabulary = vocabulary;
  }

  return { isSupported, start, stop, updateVocabulary };
}
