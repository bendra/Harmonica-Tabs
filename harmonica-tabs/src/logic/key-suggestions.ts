import { KeyQuality } from './key-detector';
import { normalizePc } from '../data/notes';

/**
 * The scale we set on a detected key, matching how players approach each
 * tonality: major → Mixolydian (the classic 2nd-position "cross harp" sound),
 * minor → Dorian (the common 3rd-position minor sound).
 */
export type QualityRecommendation = {
  positionNumber: number;
  scaleId: string;
};

const RECOMMENDATIONS: Record<KeyQuality, QualityRecommendation> = {
  major: { positionNumber: 2, scaleId: 'mixolydian' },
  minor: { positionNumber: 3, scaleId: 'dorian' },
};

export function recommendedForQuality(quality: KeyQuality): QualityRecommendation {
  return RECOMMENDATIONS[quality];
}

/**
 * Maps a harmonica position to the harp whose root lands the given target key at
 * that position (inverse of getTargetRootPcForPosition).
 */
function harpForPosition(tonicPc: number, positionNumber: number): number {
  return normalizePc(tonicPc - (positionNumber - 1) * 7);
}

/**
 * One idiomatic harp choice for a key: the harp, the position number, and an
 * optional vernacular "feel" label (1st = straight, 2nd = cross).
 */
export type HarpChoice = {
  harmonicaPc: number;
  positionNumber: number;
  feel?: string;
};

/**
 * The harps a player would actually reach for to play a given key, chosen so the
 * position's native mode matches the key's quality (so we never suggest a
 * minor-mode position over a major song):
 *
 *   - major → 1st position (straight harp, Ionian) and 2nd position (cross harp,
 *     Mixolydian) — the two standard major/blues choices.
 *   - minor → 3rd position (Dorian) — the standard minor choice.
 *
 * The relative key (see relativeKey) covers the other tonal reading, since a key
 * and its relative share the same notes.
 */
export function idiomaticHarpsForKey(tonicPc: number, quality: KeyQuality): HarpChoice[] {
  if (quality === 'major') {
    return [
      { harmonicaPc: harpForPosition(tonicPc, 1), positionNumber: 1, feel: 'straight' },
      { harmonicaPc: harpForPosition(tonicPc, 2), positionNumber: 2, feel: 'cross' },
    ];
  }
  return [{ harmonicaPc: harpForPosition(tonicPc, 3), positionNumber: 3 }];
}

/**
 * The relative major/minor of a key. A major key and its relative minor share
 * the same notes (D major ↔ B minor), so this is the "other reading" of the same
 * detected pitches — and the axis the detector is least sure about.
 */
export function relativeKey(tonicPc: number, quality: KeyQuality): { tonicPc: number; quality: KeyQuality } {
  // Relative minor is a minor third below the major tonic; relative major a
  // minor third above the minor tonic.
  return {
    tonicPc: normalizePc(quality === 'major' ? tonicPc - 3 : tonicPc + 3),
    quality: quality === 'major' ? 'minor' : 'major',
  };
}
