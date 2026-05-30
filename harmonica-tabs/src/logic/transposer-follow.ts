import { matchFrequencyToTabs } from './pitch';

export type DetectorSource = 'web' | 'native' | 'webview' | 'sim' | null;

export type DetectorSnapshot = {
  frequency: number | null;
  confidence: number;
  rms: number;
  source: DetectorSource;
  lastDetectedAt: number | null;
};

export function isMicDetectorSource(source: DetectorSource): boolean {
  return source === 'web' || source === 'native' || source === 'webview';
}

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
  // Running min of RMS since the most recent new peak. Reset to +Infinity
  // when not tracking a note. The floor resets when peak grows, so it only
  // gets small once the note has actually started decaying past its peak.
  releaseFloorRms: number;
  // Peak of the most recently released note. null until the first release;
  // used to gate same-pitch advancement so a fresh state cannot skip the
  // first of a repeated run, and so subsequent same-pitch articulations
  // require a real attack rather than a tiny dip.
  prevAttackPeak: number | null;
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

// Below this RMS, treat the signal as too quiet to count as a real note.
// Matches the gate in fft-detector.ts so we don't react to detector noise.
const MIN_RMS = 0.005;

// Fraction of the previously released note's peak that the next attack must
// reach before we advance through a same-pitch repeat. Kept as a fixed
// constant (not the user-facing slider) so the slider has one clear job:
// controlling release sensitivity. Decoupling these two thresholds is what
// makes the slider's behavior monotonic.
const RECOVERY_ATTACK_RATIO = 0.5;

export function createTransposerFollowState(activeTokenIndex: number | null): TransposerFollowState {
  return {
    activeTokenIndex,
    waitingForRelease: false,
    peakRmsSinceAdvance: 0,
    releaseFloorRms: Number.POSITIVE_INFINITY,
    prevAttackPeak: null,
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
    releaseFloorRms: state.releaseFloorRms,
    prevAttackPeak: state.prevAttackPeak,
  };

  if (!enabled) {
    return {
      state: createTransposerFollowState(safeIndex),
      status: detector.source ? 'listening' : 'idle',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  if (!detector.source) {
    return {
      state: createTransposerFollowState(safeIndex),
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

  // ---- Stage 1: while waiting for release, track peak/floor and test release. ----
  // The floor is "lowest RMS since the most recent new peak" — so a rising
  // attack resets the floor as the peak grows, and the floor only gets small
  // once we're past the peak and the note is actually decaying. This is what
  // makes release fire on real playing instead of latching forever as the
  // peak ratchets up across successive articulations.
  if (nextState.waitingForRelease) {
    if (currentRms > nextState.peakRmsSinceAdvance) {
      nextState.peakRmsSinceAdvance = currentRms;
      nextState.releaseFloorRms = currentRms;
    } else {
      nextState.releaseFloorRms = Math.min(nextState.releaseFloorRms, currentRms);
    }

    const released =
      nextState.peakRmsSinceAdvance > MIN_RMS &&
      nextState.releaseFloorRms <= nextState.peakRmsSinceAdvance * noteSeparationRatio;

    // Legato: even if amplitude hasn't released, allow exit from waiting when
    // the pitch jumps to a different next-token pitch. This preserves the
    // original code's behavior of advancing smoothly through different-pitch
    // sequences without requiring an explicit release between notes.
    let legato = false;
    if (!released && hasSignal && confidentEnough) {
      const nextIndex = (safeIndex + 1) % tokens.length;
      const nextToken = tokens[nextIndex];
      if (nextToken.midi !== currentToken.midi) {
        const legatoMatch = matchFrequencyToTabs(
          [nextToken.midi],
          detector.frequency as number,
          toneToleranceCents,
        );
        legato = Boolean(legatoMatch?.withinTolerance);
      }
    }

    if (!released && !legato) {
      return {
        state: nextState,
        status: 'waiting-for-release',
        centsOffset,
        matchingTarget: matchingCurrent,
      };
    }

    // Release (or legato) fired this frame. Capture the peak (not the dip
    // value) as the recovery reference, reset peak/floor, and fall through
    // so Stage 3 can advance the cursor if appropriate.
    nextState.prevAttackPeak = nextState.peakRmsSinceAdvance;
    nextState.waitingForRelease = false;
    nextState.peakRmsSinceAdvance = 0;
    nextState.releaseFloorRms = Number.POSITIVE_INFINITY;
  }

  // ---- Stage 2: no usable signal → report listening, keep state. ----
  if (!hasSignal || !confidentEnough) {
    return {
      state: nextState,
      status: 'listening',
      centsOffset: null,
      matchingTarget: false,
    };
  }

  // ---- Stage 3: try to advance to the next token. ----
  // Different-pitch next: advance the instant the next pitch is heard (legato).
  // Same-pitch next: require a real new attack — current RMS must reach a
  // fraction of the previous note's peak (RECOVERY_ATTACK_RATIO). This is the
  // fix for the "slider has no effect" bug: the slider only controls release
  // sensitivity now, and recovery uses an independent constant.
  const nextIndex = (safeIndex + 1) % tokens.length;
  const nextToken = tokens[nextIndex];
  const nextMatch = matchFrequencyToTabs(
    [nextToken.midi],
    detector.frequency as number,
    toneToleranceCents,
  );
  const samePitchNextToken = nextToken.midi === currentToken.midi;
  const canAdvance =
    Boolean(nextMatch?.withinTolerance) &&
    (!samePitchNextToken ||
      (nextState.prevAttackPeak !== null &&
        currentRms >= nextState.prevAttackPeak * RECOVERY_ATTACK_RATIO));

  if (canAdvance) {
    return {
      state: {
        activeTokenIndex: nextIndex,
        waitingForRelease: true,
        peakRmsSinceAdvance: currentRms,
        releaseFloorRms: currentRms,
        prevAttackPeak: nextState.prevAttackPeak,
      },
      status: 'advanced',
      centsOffset: nextMatch?.centsOffset ?? null,
      matchingTarget: true,
    };
  }

  // ---- Stage 4: first-attack handling for fresh state. ----
  // Without this, on a fresh state with a repeated-pitch sequence the cursor
  // would sit at index 0 indefinitely — Stage 3 can't advance (prevAttackPeak
  // is null) and Stage 1 can't run (waitingForRelease is false). Marking the
  // first articulation here lets the rest of the state machine work normally.
  if (
    !nextState.waitingForRelease &&
    nextState.prevAttackPeak === null &&
    nextState.peakRmsSinceAdvance === 0 &&
    matchingCurrent &&
    currentRms > MIN_RMS
  ) {
    return {
      state: {
        ...nextState,
        waitingForRelease: true,
        peakRmsSinceAdvance: currentRms,
        releaseFloorRms: currentRms,
      },
      status: 'matching-current',
      centsOffset,
      matchingTarget: true,
    };
  }

  // ---- Stage 5: default — match or no-match against the current token. ----
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
