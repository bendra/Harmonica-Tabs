import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAudioPitchDetector } from '../../src/logic/web-audio';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createTrack() {
  return {
    onended: null as null | (() => void),
    stop: vi.fn(),
  };
}

function createStream(track = createTrack()) {
  return {
    getTracks: () => [track],
  };
}

function createAudioContextHarness(options?: {
  initialState?: 'running' | 'suspended';
  resumeError?: Error;
  createMediaStreamSourceError?: Error;
}) {
  const instances: any[] = [];

  class MockAudioContext {
    state: 'running' | 'suspended';
    sampleRate = 44_100;
    destination = { kind: 'destination' };
    sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    processorNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null as null | ((event: any) => void),
    };
    gainNode = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    resume = vi.fn(async () => {
      if (options?.resumeError) {
        throw options.resumeError;
      }
      this.state = 'running';
    });
    close = vi.fn(async () => {});

    constructor() {
      this.state = options?.initialState ?? 'running';
      instances.push(this);
    }

    createMediaStreamSource() {
      if (options?.createMediaStreamSourceError) {
        throw options.createMediaStreamSourceError;
      }
      return this.sourceNode;
    }

    createScriptProcessor() {
      return this.processorNode;
    }

    createGain() {
      return this.gainNode;
    }
  }

  return { MockAudioContext, instances };
}

describe('createWebAudioPitchDetector', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts and stops cleanly after a successful microphone session', async () => {
    const track = createTrack();
    const stream = createStream(track);
    const { MockAudioContext, instances } = createAudioContextHarness();
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal('AudioContext', MockAudioContext);

    const detector = createWebAudioPitchDetector();
    const onUpdate = vi.fn();

    await detector.start(onUpdate);

    expect(detector.isSupported()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(track.onended).toBeTypeOf('function');

    detector.stop();
    await Promise.resolve();

    expect(track.onended).toBeNull();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(instances[0].processorNode.onaudioprocess).toBeNull();
    expect(instances[0].processorNode.disconnect).toHaveBeenCalledTimes(1);
    expect(instances[0].sourceNode.disconnect).toHaveBeenCalledTimes(1);
    expect(instances[0].gainNode.disconnect).toHaveBeenCalledTimes(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('releases microphone resources when startup fails after getUserMedia succeeds', async () => {
    const track = createTrack();
    const stream = createStream(track);
    const { MockAudioContext, instances } = createAudioContextHarness({
      initialState: 'suspended',
      resumeError: new Error('resume failed'),
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal('AudioContext', MockAudioContext);

    const detector = createWebAudioPitchDetector();

    await expect(detector.start(vi.fn())).rejects.toThrow('resume failed');

    expect(instances).toHaveLength(1);
    expect(track.onended).toBeNull();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('makes repeated stop calls safe and idempotent', async () => {
    const track = createTrack();
    const stream = createStream(track);
    const { MockAudioContext, instances } = createAudioContextHarness();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal('AudioContext', MockAudioContext);

    const detector = createWebAudioPitchDetector();

    await detector.start(vi.fn());
    detector.stop();
    detector.stop();
    await Promise.resolve();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('reuses one in-flight startup and routes updates to the latest callback', async () => {
    const track = createTrack();
    const stream = createStream(track);
    const streamDeferred = createDeferred<typeof stream>();
    const { MockAudioContext, instances } = createAudioContextHarness();
    const getUserMedia = vi.fn(async () => streamDeferred.promise);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal('AudioContext', MockAudioContext);

    const detector = createWebAudioPitchDetector();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const firstStart = detector.start(firstHandler);
    const secondStart = detector.start(secondHandler);

    streamDeferred.resolve(stream);
    await Promise.all([firstStart, secondStart]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    instances[0].processorNode.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0, 0, 0, 0]),
      },
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledWith({
      frequency: null,
      confidence: 0,
      rms: 0,
    });
  });

  it('ignores saved track-end handlers after stop clears the session', async () => {
    const track = createTrack();
    const stream = createStream(track);
    const { MockAudioContext } = createAudioContextHarness();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal('AudioContext', MockAudioContext);

    const detector = createWebAudioPitchDetector();
    const onUpdate = vi.fn();

    await detector.start(onUpdate);
    const endedHandler = track.onended;

    detector.stop();
    await Promise.resolve();
    endedHandler?.();

    expect(track.onended).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
