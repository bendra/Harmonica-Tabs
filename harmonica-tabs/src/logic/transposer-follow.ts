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
  | 'matching-current'
  | 'advanced'
  | 'waiting-for-release'
  | 'no-match';

export type TransposerFollowState = {
  activeTokenIndex: number | null;
  waitingForRelease: boolean;
  peakRmsSinceAdvance: number;
  lastAmplitudeReleaseRms: number | null;
};

export type EvaluateTransposerFollowInput = {
  enabled: boolean;
  tokens: FollowableToken[];
  state: TransposerFollowState;
  detector: DetectorSnapshot;
  toneToleranceCents: number;
  minConfidence: number;
  noteSeparationRatio: number;
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
    waitingForRelease: false,
    peakRmsSinceAdvance: 0,
    lastAmplitudeReleaseRms: null,
  };
}

function safeRms(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function evaluateTransposerFollow(
  input: EvaluateTransposerFollowInput,
): EvaluateTransposerFollowResult {
  const {
    detector,
    enabled,
    minConfidence,
    noteSeparationRatio,
    state,
    tokens,
    toneToleranceCents,
  } = input;

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
    waitingForRelease: state.waitingForRelease,
    peakRmsSinceAdvance: state.peakRmsSinceAdvance,
    lastAmplitudeReleaseRms: state.lastAmplitudeReleaseRms,
  };

  if (!enabled) {
    return {
      state: {
        ...nextState,
        waitingForRelease: false,
        peakRmsSinceAdvance: 0,
        lastAmplitudeReleaseRms: null,
      },
      status: detector.source ? 'listening' : 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  if (!detector.source) {
    return {
      state: {
        ...nextState,
        waitingForRelease: false,
        peakRmsSinceAdvance: 0,
        lastAmplitudeReleaseRms: null,
      },
      status: 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  const hasSignal = detector.frequency !== null && Number.isFinite(detector.frequency);
  const confidentEnough = detector.confidence >= minConfidence;
  const currentToken = tokens[safeIndex];
  const currentRms = safeRms(detector.rms);

  const currentMatch =
    hasSignal && confidentEnough
      ? matchFrequencyToTabs([currentToken.midi], detector.frequency as number, toneToleranceCents)
      : null;
  const matchingCurrent = Boolean(currentMatch?.withinTolerance);
  const centsOffset = currentMatch ? currentMatch.centsOffset : null;

  // After advancing, block further advancement until the pitch drops, changes,
  // or the player articulates the same pitch with a clear RMS dip.
  if (nextState.waitingForRelease) {
    nextState.peakRmsSinceAdvance = Math.max(nextState.peakRmsSinceAdvance, currentRms);
    const releasedByAmplitude =
      matchingCurrent &&
      nextState.peakRmsSinceAdvance > 0 &&
      currentRms <= nextState.peakRmsSinceAdvance * noteSeparationRatio;

    if (matchingCurrent && !releasedByAmplitude) {
      return {
        state: nextState,
        status: 'waiting-for-release',
        centsOffset,
        matchingTarget: true,
      };
    }

    nextState.waitingForRelease = false;
    nextState.peakRmsSinceAdvance = 0;

    if (releasedByAmplitude) {
      nextState.lastAmplitudeReleaseRms = currentRms;
      return {
        state: nextState,
        status: 'matching-current',
        centsOffset,
        matchingTarget: true,
      };
    }
  }

  if (!hasSignal || !confidentEnough) {
    return {
      state: nextState,
      status: 'listening',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  // Check next token first — if player has moved to the next note, advance immediately.
  const nextIndex = (safeIndex + 1) % tokens.length;
  const nextToken = tokens[nextIndex];
  const nextMatch = matchFrequencyToTabs(
    [nextToken.midi],
    detector.frequency as number,
    toneToleranceCents,
  );
  const samePitchNextToken = nextToken.midi === currentToken.midi;
  const hasRecoveredFromAmplitudeRelease =
    nextState.lastAmplitudeReleaseRms === null ||
    !samePitchNextToken ||
    currentRms > nextState.lastAmplitudeReleaseRms / noteSeparationRatio;

  if (nextMatch?.withinTolerance && hasRecoveredFromAmplitudeRelease) {
    return {
      state: {
        activeTokenIndex: nextIndex,
        waitingForRelease: true,
        peakRmsSinceAdvance: currentRms,
        lastAmplitudeReleaseRms: null,
      },
      status: 'advanced',
      centsOffset: nextMatch.centsOffset,
      matchingTarget: true,
    };
  }

  if (matchingCurrent) {
    return {
      state: nextState,
      status: 'matching-current',
      centsOffset,
      matchingTarget: true,
    };
  }

  return {
    state: nextState,
    status: 'no-match',
    centsOffset,
    matchingTarget: false,
  };
}
