export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function frequencyToCents(frequency: number): number {
  return frequencyToMidi(frequency) * 100;
}

export type TabPitchMatch = {
  activeIndex: number;
  leftIndex: number;
  rightIndex: number;
  t: number;
  centsOffset: number;
  withinTolerance: boolean;
};

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
