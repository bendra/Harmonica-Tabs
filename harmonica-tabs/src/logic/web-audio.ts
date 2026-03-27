/**
 * Streaming pitch detector update emitted from the microphone loop.
 */
type PitchUpdate = {
  frequency: number | null;
  confidence: number;
  rms: number;
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
  let emaFrequency: number | null = null;
  let onUpdateRef: PitchUpdateHandler | null = null;

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
      emaFrequency = null;
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
   */
  async function start(onUpdate: PitchUpdateHandler) {
    onUpdateRef = onUpdate;
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
        resources.processor = resources.audioContext.createScriptProcessor(2048, 1, 1);
        resources.gainNode = resources.audioContext.createGain();
        resources.gainNode.gain.value = 0.001;

        resources.stream.getTracks?.().forEach((track: any) => {
          track.onended = () => {
            if (generation !== startGeneration || !running) return;
            onUpdateRef?.({ frequency: null, confidence: 0, rms: 0 });
          };
        });

        resources.processor.onaudioprocess = (event: any) => {
          if (generation !== startGeneration || !running || !resources.audioContext) return;
          const input = event.inputBuffer?.getChannelData(0);
          if (!input) return;
          const result = detectPitch(input, resources.audioContext.sampleRate);
          if (!result) {
            const rms = calculateRms(input);
            onUpdateRef?.({ frequency: null, confidence: 0, rms });
            return;
          }

          const smoothed =
            emaFrequency === null ? result.frequency : emaFrequency + 0.2 * (result.frequency - emaFrequency);
          emaFrequency = smoothed;
          onUpdateRef?.({ frequency: smoothed, confidence: result.confidence, rms: result.rms });
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
        emaFrequency = null;
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
    emaFrequency = null;
    onUpdateRef = null;
    void cleanupResources(resources, { clearCallback: false, resetGlobal: false });
  }

  return { isSupported, start, stop };
}

/**
 * Calculates root-mean-square energy of an audio frame.
 */
function calculateRms(input: Float32Array) {
  const size = input.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const value = input[i];
    rms += value * value;
  }
  return Math.sqrt(rms / size);
}

/**
 * Estimates pitch using normalized auto-correlation with parabolic refinement.
 */
function detectPitch(input: Float32Array, sampleRate: number) {
  const rms = calculateRms(input);
  if (rms < 0.005) return null;

  const size = input.length;
  const minFreq = 80;
  const maxFreq = 2000;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(size - 1, Math.floor(sampleRate / minFreq));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestVal = Number.NEGATIVE_INFINITY;
  const correlations = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < size - lag; i += 1) {
      const x = input[i];
      const y = input[i + lag];
      sum += x * y;
      sumSq += x * x;
    }
    const norm = Math.sqrt(sumSq) || 1;
    const corr = sum / norm;
    correlations[lag] = corr;
    if (corr > bestVal) {
      bestVal = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;

  let refinedLag = bestLag;
  if (bestLag + 1 <= maxLag && bestLag - 1 >= minLag) {
    const x1 = correlations[bestLag - 1];
    const x2 = correlations[bestLag];
    const x3 = correlations[bestLag + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a !== 0) {
      refinedLag = bestLag - b / (2 * a);
    }
  }

  const frequency = sampleRate / refinedLag;
  const confidence = Math.max(0, Math.min(1, bestVal));
  return { frequency, confidence, rms };
}
