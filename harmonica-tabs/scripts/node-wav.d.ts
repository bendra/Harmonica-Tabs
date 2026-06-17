// Minimal type declaration for the untyped `node-wav` package (devDependency),
// used by the offline key-detection eval script.
declare module 'node-wav' {
  export function decode(buffer: Buffer | Uint8Array): {
    sampleRate: number;
    channelData: Float32Array[];
  };
  export function encode(
    channelData: Float32Array[],
    opts: { sampleRate: number; float?: boolean; bitDepth?: number },
  ): Buffer;
}
