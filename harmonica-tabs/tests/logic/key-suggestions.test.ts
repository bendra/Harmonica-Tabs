import { describe, expect, it } from 'vitest';
import {
  idiomaticHarpsForKey,
  recommendedForQuality,
  relativeKey,
} from '../../src/logic/key-suggestions';
import { noteToPc } from '../../src/data/notes';

describe('recommendedForQuality', () => {
  it('maps major to 2nd position / Mixolydian (cross-harp go-to)', () => {
    expect(recommendedForQuality('major')).toEqual({ positionNumber: 2, scaleId: 'mixolydian' });
  });

  it('maps minor to 3rd position / Dorian', () => {
    expect(recommendedForQuality('minor')).toEqual({ positionNumber: 3, scaleId: 'dorian' });
  });
});

describe('relativeKey', () => {
  it('returns B minor for D major (relative minor a minor third down)', () => {
    expect(relativeKey(noteToPc('D'), 'major')).toEqual({ tonicPc: noteToPc('B'), quality: 'minor' });
  });

  it('returns D major for B minor (relative major a minor third up)', () => {
    expect(relativeKey(noteToPc('B'), 'minor')).toEqual({ tonicPc: noteToPc('D'), quality: 'major' });
  });
});

describe('idiomaticHarpsForKey', () => {
  it('gives D harp 1st (straight) and G harp 2nd (cross) for D major', () => {
    expect(idiomaticHarpsForKey(noteToPc('D'), 'major')).toEqual([
      { harmonicaPc: noteToPc('D'), positionNumber: 1, feel: 'straight' },
      { harmonicaPc: noteToPc('G'), positionNumber: 2, feel: 'cross' },
    ]);
  });

  it('gives A harp 3rd for B minor', () => {
    expect(idiomaticHarpsForKey(noteToPc('B'), 'minor')).toEqual([
      { harmonicaPc: noteToPc('A'), positionNumber: 3 },
    ]);
  });
});
