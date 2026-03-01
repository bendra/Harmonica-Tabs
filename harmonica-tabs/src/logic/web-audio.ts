type PitchUpdate = {
  frequency: number | null;
  confidence: number;
  rms: number;
};

type PitchUpdateHandler = (update: PitchUpdate) => void;

export function createWebAudioPitchDetector() {
  let audioContext: any = null;
  let source: any = null;
  let processor: any = null;
  let gainNode: any = null;
  let stream: any = null;
  let running = false;
  let emaFrequency: number | null = null;
  let onUpdateRef: PitchUpdateHandler | null = null;

  function isSupported() {
    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    return Boolean(mediaDevices?.getUserMedia && AudioContextCtor);
  }

  async function start(onUpdate: PitchUpdateHandler) {
    if (running) return;
    onUpdateRef = onUpdate;
    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!mediaDevices?.getUserMedia || !AudioContextCtor) {
      throw new Error('Web audio not supported');
    }

    stream = await mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContextCtor();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0.001;

    stream.getTracks?.().forEach((track: any) => {
      track.onended = () => {
        onUpdateRef?.({ frequency: null, confidence: 0, rms: 0 });
      };
    });

    processor.onaudioprocess = (event: any) => {
      const input = event.inputBuffer?.getChannelData(0);
      if (!input) return;
      const result = detectPitch(input, audioContext.sampleRate);
      if (!result) {
        const rms = calculateRms(input);
        onUpdate({ frequency: null, confidence: 0, rms });
        return;
      }

      const smoothed =
        emaFrequency === null ? result.frequency : emaFrequency + 0.2 * (result.frequency - emaFrequency);
      emaFrequency = smoothed;
      onUpdate({ frequency: smoothed, confidence: result.confidence, rms: result.rms });
    };

    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    running = true;
  }

  function stop() {
    if (!running) return;
    try {
      processor?.disconnect();
      source?.disconnect();
      gainNode?.disconnect();
      processor = null;
      source = null;
      gainNode = null;
      emaFrequency = null;
      stream?.getTracks?.().forEach((track: any) => track.stop());
      stream = null;
      audioContext?.close?.();
      audioContext = null;
      onUpdateRef = null;
    } finally {
      running = false;
    }
  }

  return { isSupported, start, stop };
}

function calculateRms(input: Float32Array) {
  const size = input.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const value = input[i];
    rms += value * value;
  }
  return Math.sqrt(rms / size);
}

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
