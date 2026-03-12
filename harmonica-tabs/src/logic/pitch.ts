/**
 * Converts a MIDI note number to frequency in Hz (A4 = 440 Hz).
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Converts a frequency in Hz to fractional MIDI note number.
 */
export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * Converts frequency in Hz to absolute cents (100 cents per MIDI step).
 */
export function frequencyToCents(frequency: number): number {
  return frequencyToMidi(frequency) * 100;
}

/**
 * Describes where a detected frequency sits relative to available tab notes.
 */
export type TabPitchMatch = {
  activeIndex: number;
  leftIndex: number;
  rightIndex: number;
  t: number;
  centsOffset: number;
  withinTolerance: boolean;
};

/**
 * Matches a detected frequency to the nearest available tab note and neighbors.
 */
export function matchFrequencyToTabs(
  midis: number[],
  frequency: number,
  toleranceCents: number,
): TabPitchMatch | null {
  if (!Number.isFinite(frequency) || midis.length === 0) return null;
  const cents = frequencyToCents(frequency);
  const centsList = midis.map((midi) => midi * 100);

  let activeIndex = 0;
  let minDiff = Number.POSITIVE_INFINITY;
  centsList.forEach((value, index) => {
    const diff = Math.abs(cents - value);
    if (diff < minDiff) {
      minDiff = diff;
      activeIndex = index;
    }
  });

  let rightIndex = centsList.findIndex((value) => value >= cents);
  if (rightIndex === -1) rightIndex = centsList.length - 1;
  let leftIndex = Math.max(0, rightIndex - 1);
  if (rightIndex === 0) leftIndex = 0;

  const leftCents = centsList[leftIndex];
  const rightCents = centsList[rightIndex];
  const denom = rightCents - leftCents;
  const t = denom === 0 ? 0 : Math.min(1, Math.max(0, (cents - leftCents) / denom));

  return {
    activeIndex,
    leftIndex,
    rightIndex,
    t,
    centsOffset: cents - centsList[activeIndex],
    withinTolerance: minDiff <= toleranceCents,
  };
}
