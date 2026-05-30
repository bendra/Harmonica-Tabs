import * as fs from 'fs';

export type DecodedWav = {
  sampleRate: number;
  channelData: Float32Array[];
};

// Minimal RIFF/WAVE decoder for the test fixtures in sound-samples/. Supports
// 16-bit and 32-bit PCM mono/stereo (the formats `afconvert` produces). Kept
// in sync with the inline decoder in scripts/detect-offline.ts — extract that
// into a shared module if a third caller appears.
export function decodeWavFile(filePath: string): DecodedWav {
  return decodeWav(fs.readFileSync(filePath));
}

export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a RIFF file');
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = -1;

  let pos = 12;
  while (pos < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkSize = buffer.readUInt32LE(pos + 4);
    pos += 8;

    if (chunkId === 'fmt ') {
      const formatTag = buffer.readUInt16LE(pos);
      if (formatTag !== 1 && formatTag !== 0xfffe) {
        throw new Error(`Unsupported WAV format tag: 0x${formatTag.toString(16)}`);
      }
      channels = buffer.readUInt16LE(pos + 2);
      sampleRate = buffer.readUInt32LE(pos + 4);
      bitsPerSample = buffer.readUInt16LE(pos + 14);
    } else if (chunkId === 'data') {
      dataOffset = pos;
      dataLength = chunkSize;
    }

    pos += chunkSize;
    if (chunkSize % 2 !== 0) pos++;
  }

  if (sampleRate === 0) throw new Error('WAV fmt chunk not found');
  if (dataOffset === -1) throw new Error('WAV data chunk not found');

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (bytesPerSample * channels));
  const channelData: Float32Array[] = Array.from(
    { length: channels },
    () => new Float32Array(totalSamples),
  );
  const scale = 1 / Math.pow(2, bitsPerSample - 1);

  for (let i = 0; i < totalSamples; i++) {
    for (let c = 0; c < channels; c++) {
      const offset = dataOffset + (i * channels + c) * bytesPerSample;
      const sample = bitsPerSample === 16 ? buffer.readInt16LE(offset) : buffer.readInt32LE(offset);
      channelData[c][i] = sample * scale;
    }
  }

  return { sampleRate, channelData };
}
