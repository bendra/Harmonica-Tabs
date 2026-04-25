import { detectSingleNote } from './fft-detector';
import { HarmonicaVocabulary } from './harmonica-frequencies';
import { PitchUpdateTrace } from './audio-latency';

/**
 * Streaming pitch detector update emitted from the microphone loop.
 */
type PitchUpdate = {
  frequency: number | null;
  rawFrequency: number | null;
  confidence: number;
  rms: number;
  trace?: PitchUpdateTrace | null;
};

type PitchUpdateHandler = (update: PitchUpdate) => void;

/**
 * Creates a minimal Web Audio pitch detector with start/stop controls.
 */
export function createWebAudioPitchDetector() {
  let audioContext: any = null;
  let source: any = null;
  let processor: any = null;
  let gainNode: any = null;
  let stream: any = null;
  let running = false;
  let startPromise: Promise<void> | null = null;
  let generation = 0;
  let onUpdateRef: PitchUpdateHandler | null = null;
  let currentVocabulary: HarmonicaVocabulary | null = null;

  function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  async function cleanupResources(
    resources: {
      audioContext: any;
      source: any;
      processor: any;
      gainNode: any;
      stream: any;
    },
    options: {
      clearCallback: boolean;
      resetGlobal: boolean;
    },
  ) {
    const currentProcessor = resources.processor;
    const currentSource = resources.source;
    const currentGainNode = resources.gainNode;
    const currentStream = resources.stream;
    const currentAudioContext = resources.audioContext;
    const tracks = currentStream?.getTracks?.() ?? [];

    tracks.forEach((track: any) => {
      track.onended = null;
    });

    if (currentProcessor) {
      currentProcessor.onaudioprocess = null;
    }

    try {
      currentProcessor?.disconnect?.();
    } catch {}

    try {
      currentSource?.disconnect?.();
    } catch {}

    try {
      currentGainNode?.disconnect?.();
    } catch {}

    tracks.forEach((track: any) => {
      try {
        track.stop?.();
      } catch {}
    });

    try {
      await currentAudioContext?.close?.();
    } catch {}

    if (options.resetGlobal) {
      if (processor === currentProcessor) {
        processor = null;
      }
      if (source === currentSource) {
        source = null;
      }
      if (gainNode === currentGainNode) {
        gainNode = null;
      }
      if (stream === currentStream) {
        stream = null;
      }
      if (audioContext === currentAudioContext) {
        audioContext = null;
      }
    }

    if (options.clearCallback) {
      onUpdateRef = null;
    }
  }

  /**
   * Checks browser support for required media and audio APIs.
   */
  function isSupported() {
    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    return Boolean(mediaDevices?.getUserMedia && AudioContextCtor);
  }

  /**
   * Starts microphone capture and emits pitch updates.
   *
   * Uses a 4096-sample buffer for the ScriptProcessor — large enough for
   * the Goertzel algorithm to distinguish adjacent harmonica notes (~20–30 Hz
   * apart in the middle octave, requiring <10 Hz frequency resolution).
   */
  async function start(onUpdate: PitchUpdateHandler, vocabulary: HarmonicaVocabulary) {
    onUpdateRef = onUpdate;
    currentVocabulary = vocabulary;
    if (running) return;
    if (startPromise) {
      await startPromise;
      return;
    }

    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!mediaDevices?.getUserMedia || !AudioContextCtor) {
      throw new Error('Web audio not supported');
    }

    const startGeneration = ++generation;
    const resources = {
      audioContext: null as any,
      source: null as any,
      processor: null as any,
      gainNode: null as any,
      stream: null as any,
    };

    const pendingStart = (async () => {
      try {
        resources.stream = await mediaDevices.getUserMedia({ audio: true });
        if (generation !== startGeneration) {
          await cleanupResources(resources, { clearCallback: false, resetGlobal: false });
          return;
        }

        resources.audioContext = new AudioContextCtor();
        if (resources.audioContext.state === 'suspended') {
          await resources.audioContext.resume();
        }
        if (generation !== startGeneration) {
          await cleanupResources(resources, { clearCallback: false, resetGlobal: false });
          return;
        }

        resources.source = resources.audioContext.createMediaStreamSource(resources.stream);
        resources.processor = resources.audioContext.createScriptProcessor(4096, 1, 1);
        resources.gainNode = resources.audioContext.createGain();
        resources.gainNode.gain.value = 0.001;

        resources.stream.getTracks?.().forEach((track: any) => {
          track.onended = () => {
            if (generation !== startGeneration || !running) return;
            onUpdateRef?.({ frequency: null, rawFrequency: null, confidence: 0, rms: 0 });
          };
        });

        resources.processor.onaudioprocess = (event: any) => {
          if (generation !== startGeneration || !running || !resources.audioContext) return;
          const input = event.inputBuffer?.getChannelData(0);
          if (!input || !currentVocabulary) return;
          const callbackAtMs = nowMs();
          const detectorStartAtMs = callbackAtMs;
          const result = detectSingleNote(input, resources.audioContext.sampleRate, currentVocabulary);
          const detectorEndAtMs = nowMs();
          const frameDurationMs = (input.length / resources.audioContext.sampleRate) * 1000;
          onUpdateRef?.({
            ...result,
            trace: {
              frameDurationMs,
              callbackAtMs,
              estimatedFrameStartAtMs: callbackAtMs - frameDurationMs,
              detectorStartAtMs,
              detectorEndAtMs,
              detectorDurationMs: detectorEndAtMs - detectorStartAtMs,
            },
          });
        };

        resources.source.connect(resources.processor);
        resources.processor.connect(resources.gainNode);
        resources.gainNode.connect(resources.audioContext.destination);

        if (generation !== startGeneration) {
          await cleanupResources(resources, { clearCallback: false, resetGlobal: false });
          return;
        }

        audioContext = resources.audioContext;
        source = resources.source;
        processor = resources.processor;
        gainNode = resources.gainNode;
        stream = resources.stream;
        running = true;
      } catch (error) {
        await cleanupResources(resources, { clearCallback: false, resetGlobal: false });
        throw error;
      }
    })();

    startPromise = pendingStart;
    try {
      await pendingStart;
    } finally {
      if (startPromise === pendingStart) {
        startPromise = null;
      }
    }
  }

  /**
   * Stops processing and releases audio resources.
   */
  function stop() {
    generation += 1;
    running = false;
    startPromise = null;
    const resources = { audioContext, source, processor, gainNode, stream };
    audioContext = null;
    source = null;
    processor = null;
    gainNode = null;
    stream = null;
    currentVocabulary = null;
    onUpdateRef = null;
    void cleanupResources(resources, { clearCallback: false, resetGlobal: false });
  }

  function updateVocabulary(vocabulary: HarmonicaVocabulary) {
    currentVocabulary = vocabulary;
  }

  return { isSupported, start, stop, updateVocabulary };
}
