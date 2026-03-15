import { describe, expect, it } from 'vitest';
import {
  detectTransposerInputMode,
  WEB_TABLET_LONG_SIDE_MAX,
  WEB_TABLET_SHORT_SIDE_MAX,
} from '../../src/logic/transposer-input-mode';

describe('detectTransposerInputMode', () => {
  it('defaults native iOS and Android builds to the tab pad', () => {
    expect(
      detectTransposerInputMode({
        platformOs: 'ios',
        viewportWidth: 390,
        viewportHeight: 844,
        coarsePointerMediaMatches: false,
        maxTouchPoints: 0,
      }).defaultMode,
    ).toBe('pad');

    expect(
      detectTransposerInputMode({
        platformOs: 'android',
        viewportWidth: 412,
        viewportHeight: 915,
        coarsePointerMediaMatches: false,
        maxTouchPoints: 0,
      }).defaultMode,
    ).toBe('pad');
  });

  it('defaults iPhone-like coarse-pointer web to the tab pad', () => {
    const result = detectTransposerInputMode({
      platformOs: 'web',
      viewportWidth: 390,
      viewportHeight: 844,
      coarsePointerMediaMatches: true,
      maxTouchPoints: 5,
    });

    expect(result.defaultMode).toBe('pad');
    expect(result.hasTouchCapability).toBe(true);
  });

  it('defaults iPad-like touch web to the tab pad', () => {
    const result = detectTransposerInputMode({
      platformOs: 'web',
      viewportWidth: 1024,
      viewportHeight: 1366,
      coarsePointerMediaMatches: false,
      maxTouchPoints: 5,
    });

    expect(result.shortSide).toBe(WEB_TABLET_SHORT_SIDE_MAX);
    expect(Math.max(1024, 1366)).toBe(WEB_TABLET_LONG_SIDE_MAX);
    expect(result.defaultMode).toBe('pad');
    expect(result.hasTouchCapability).toBe(true);
  });

  it('keeps desktop-style web on native typing', () => {
    const result = detectTransposerInputMode({
      platformOs: 'web',
      viewportWidth: 1440,
      viewportHeight: 900,
      coarsePointerMediaMatches: false,
      maxTouchPoints: 0,
    });

    expect(result.defaultMode).toBe('native');
    expect(result.hasTouchCapability).toBe(false);
  });

  it('keeps touchscreen-capable desktop web on native typing when hover and pointer stay desktop-like', () => {
    const result = detectTransposerInputMode({
      platformOs: 'web',
      viewportWidth: 1440,
      viewportHeight: 900,
      coarsePointerMediaMatches: false,
      maxTouchPoints: 10,
    });

    expect(result.defaultMode).toBe('native');
    expect(result.hasTouchCapability).toBe(true);
  });
});
