export type TransposerInputMode = 'pad' | 'native';

export type DetectTransposerInputModeParams = {
  platformOs: string;
  viewportWidth: number;
  viewportHeight: number;
  coarsePointerMediaMatches: boolean;
  maxTouchPoints: number;
};

export type TransposerInputModeDetection = {
  defaultMode: TransposerInputMode;
  hasTouchCapability: boolean;
  shortSide: number;
};

export const WEB_TABLET_SHORT_SIDE_MAX = 1024;
export const WEB_TABLET_LONG_SIDE_MAX = 1366;

/**
 * Detects whether the transposer should default to the custom pad or native typing.
 */
export function detectTransposerInputMode(
  params: DetectTransposerInputModeParams,
): TransposerInputModeDetection {
  const shortSide = Math.min(params.viewportWidth, params.viewportHeight);
  const longSide = Math.max(params.viewportWidth, params.viewportHeight);

  if (params.platformOs !== 'web') {
    return {
      defaultMode: 'pad',
      hasTouchCapability: false,
      shortSide,
    };
  }

  const hasTouchPoints = params.maxTouchPoints > 0;
  const hasTouchCapability = params.coarsePointerMediaMatches || hasTouchPoints;
  const shouldPreferPad =
    params.coarsePointerMediaMatches ||
    (hasTouchPoints && shortSide <= WEB_TABLET_SHORT_SIDE_MAX && longSide <= WEB_TABLET_LONG_SIDE_MAX);

  return {
    defaultMode: shouldPreferPad ? 'pad' : 'native',
    hasTouchCapability,
    shortSide,
  };
}

/**
 * Reads runtime browser signals for mobile-web friendly input mode detection.
 */
export function readWebTransposerInputSignals(): {
  coarsePointerMediaMatches: boolean;
  maxTouchPoints: number;
} {
  const runtimeWindow =
    typeof window === 'undefined' ? undefined : (window as Window & { matchMedia?: (query: string) => MediaQueryList });
  const runtimeNavigator =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & {
          maxTouchPoints?: number;
        });

  const coarsePointerMediaMatches = Boolean(
    runtimeWindow?.matchMedia?.('(hover: none) and (pointer: coarse)').matches,
  );
  const maxTouchPoints = typeof runtimeNavigator?.maxTouchPoints === 'number' ? runtimeNavigator.maxTouchPoints : 0;

  return {
    coarsePointerMediaMatches,
    maxTouchPoints,
  };
}
