import { HARMONICA_KEYS } from '../data/keys';
import { getPositionNumberForTargetRootPc } from '../hooks/use-musical-selection';

/**
 * A single (harmonica, position) pair that yields a chosen target key.
 *
 * `harmonicaPc` is the pitch class (0-11) of the harmonica's root key.
 * `positionNumber` is the harmonica position number (1-12) on that harp
 * that places the target key as the position's root.
 */
export type HarmonicaSuggestion = {
  harmonicaPc: number;
  positionNumber: number;
};

/**
 * Order of position numbers from most "practical" to least.
 *
 * 1st, 2nd, 3rd, and 5th cover most popular playing styles (major-key,
 * blues, minor-blues, natural-minor). 4th is rare-but-known, the rest
 * are mostly theoretical.
 */
const PRACTICAL_POSITION_ORDER: readonly number[] = [
  1, 2, 3, 5, 4, 6, 7, 8, 9, 10, 11, 12,
];

const PRACTICAL_POSITION_RANK = new Map<number, number>(
  PRACTICAL_POSITION_ORDER.map((position, index) => [position, index]),
);

/**
 * For a chosen target pitch class, returns all 12 (harmonica, position)
 * pairs that produce it, ordered with the most practical positions first.
 *
 * The list always has length 12: every harmonica key appears exactly once,
 * paired with the unique position number that lands its root on `targetPc`.
 */
export function getHarmonicaSuggestions(targetPc: number): HarmonicaSuggestion[] {
  const suggestions = HARMONICA_KEYS.map((key) => ({
    harmonicaPc: key.pc,
    positionNumber: getPositionNumberForTargetRootPc(key.pc, targetPc),
  }));

  return suggestions.sort(
    (a, b) =>
      (PRACTICAL_POSITION_RANK.get(a.positionNumber) ?? Number.MAX_SAFE_INTEGER) -
      (PRACTICAL_POSITION_RANK.get(b.positionNumber) ?? Number.MAX_SAFE_INTEGER),
  );
}
