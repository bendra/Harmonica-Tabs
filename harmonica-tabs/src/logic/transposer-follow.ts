import { matchFrequencyToTabs } from './pitch';

export type DetectorSnapshot = {
  frequency: number | null;
  confidence: number;
  rms: number;
  source: 'web' | 'sim' | null;
  lastDetectedAt: number | null;
};

export type FollowableToken = {
  tokenIndex: number;
  text: string;
  midi: number;
};

export type TransposerFollowStatus =
  | 'idle'
  | 'listening'
  | 'holding'
  | 'advanced'
  | 'waiting-for-release'
  | 'no-match';

export type TransposerFollowState = {
  activeTokenIndex: number | null;
  matchedSince: number | null;
  waitingForRelease: boolean;
};

export type EvaluateTransposerFollowInput = {
  enabled: boolean;
  tokens: FollowableToken[];
  state: TransposerFollowState;
  detector: DetectorSnapshot;
  toneToleranceCents: number;
  minConfidence: number;
  holdDurationMs: number;
  now: number;
};

export type EvaluateTransposerFollowResult = {
  state: TransposerFollowState;
  status: TransposerFollowStatus;
  centsOffset: number | null;
  matchingTarget: boolean;
};

export function createTransposerFollowState(activeTokenIndex: number | null): TransposerFollowState {
  return {
    activeTokenIndex,
    matchedSince: null,
    waitingForRelease: false,
  };
}

export function evaluateTransposerFollow(
  input: EvaluateTransposerFollowInput,
): EvaluateTransposerFollowResult {
  const { detector, enabled, holdDurationMs, minConfidence, now, state, tokens, toneToleranceCents } = input;

  if (tokens.length === 0) {
    return {
      state: createTransposerFollowState(null),
      status: enabled && detector.source ? 'listening' : 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  const safeIndex =
    state.activeTokenIndex == null
      ? 0
      : Math.max(0, Math.min(state.activeTokenIndex, tokens.length - 1));
  const nextState: TransposerFollowState = {
    activeTokenIndex: safeIndex,
    matchedSince: state.matchedSince,
    waitingForRelease: state.waitingForRelease,
  };

  if (!enabled) {
    return {
      state: { ...nextState, matchedSince: null, waitingForRelease: false },
      status: detector.source ? 'listening' : 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  const token = tokens[safeIndex];
  const hasSignal = detector.frequency !== null && Number.isFinite(detector.frequency);
  const confidentEnough = detector.confidence >= minConfidence;
  const match =
    hasSignal && confidentEnough
      ? matchFrequencyToTabs([token.midi], detector.frequency as number, toneToleranceCents)
      : null;
  const matchingTarget = Boolean(match?.withinTolerance);
  const centsOffset = match ? match.centsOffset : null;

  if (nextState.waitingForRelease) {
    if (matchingTarget) {
      return {
        state: { ...nextState, matchedSince: null },
        status: 'waiting-for-release',
        centsOffset,
        matchingTarget: true,
      };
    }

    nextState.waitingForRelease = false;
    nextState.matchedSince = null;
  }

  if (!detector.source) {
    return {
      state: { ...nextState, matchedSince: null },
      status: 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  if (!hasSignal || !confidentEnough) {
    return {
      state: { ...nextState, matchedSince: null },
      status: 'listening',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  if (!matchingTarget) {
    return {
      state: { ...nextState, matchedSince: null },
      status: 'no-match',
      centsOffset,
      matchingTarget: false,
    };
  }

  const matchedSince = nextState.matchedSince ?? now;
  const heldForMs = now - matchedSince;

  if (heldForMs < holdDurationMs) {
    return {
      state: { ...nextState, matchedSince },
      status: 'holding',
      centsOffset,
      matchingTarget: true,
    };
  }

  return {
    state: {
      activeTokenIndex: (safeIndex + 1) % tokens.length,
      matchedSince: null,
      waitingForRelease: true,
    },
    status: 'advanced',
    centsOffset,
    matchingTarget: true,
  };
}
