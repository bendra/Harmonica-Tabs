import { useState, useMemo, useEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import { normalizePc } from '../data/notes';
import { resolveTransposerBaseShift, transposeTabTextAtShift } from '../logic/transposer';
import {
  createTransposerFollowState,
  evaluateTransposerFollow,
  TransposerFollowState,
  DetectorSnapshot,
} from '../logic/transposer-follow';
import { SavedTabRecord } from '../logic/saved-tab-library';
import { OverbendNotation } from '../logic/tabs';

const TRANSPOSER_OUTPUT_SCROLL_PADDING = 16;

type TransposerSessionParams = {
  savedTabs: SavedTabRecord[];
  transposerSourceTabId: string | null;
  transposerOctaveOffset: number;
  harmonicaPc: number;
  targetRootPc: number;
  notation: OverbendNotation;
  gAltPreference: '-2' | '3';
  audioSnapshot: DetectorSnapshot;
  toneToleranceCents: number;
  toneFollowMinConfidence: number;
  noteSeparationRatio: number;
  isListening: boolean;
};

export function useTransposerSession({
  savedTabs,
  transposerSourceTabId,
  transposerOctaveOffset,
  harmonicaPc,
  targetRootPc,
  notation,
  gAltPreference,
  audioSnapshot,
  toneToleranceCents,
  toneFollowMinConfidence,
  noteSeparationRatio,
  isListening,
}: TransposerSessionParams) {
  const [transposerFollowState, setTransposerFollowState] = useState<TransposerFollowState>(
    createTransposerFollowState(null),
  );
  const [toneFollowTick, setToneFollowTick] = useState(0);
  const [transposerOutputViewportHeight, setTransposerOutputViewportHeight] = useState(0);
  const [transposerOutputTokenLayouts, setTransposerOutputTokenLayouts] = useState<
    Record<number, { y: number; height: number }>
  >({});

  const transposerOutputScrollRef = useRef<ScrollView>(null);
  const transposerOutputScrollYRef = useRef(0);

  const transposerSourceTab = useMemo(
    () => savedTabs.find((tab) => tab.id === transposerSourceTabId) ?? null,
    [savedTabs, transposerSourceTabId],
  );

  const transposerSourceInput = transposerSourceTab?.inputText ?? '';

  const transposerBaseShift = useMemo(
    () =>
      resolveTransposerBaseShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaPc,
        targetRootPc,
        notation,
        altPreference: gAltPreference,
      }),
    [transposerSourceInput, harmonicaPc, targetRootPc, notation, gAltPreference],
  );

  const transposerDisplayShift = transposerBaseShift.semitoneShift + transposerOctaveOffset * 12;

  const transposerResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaPc,
        targetRootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaPc,
      targetRootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );

  const transposerNextDownResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaPc,
        targetRootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift - 12,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaPc,
      targetRootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );

  const transposerNextUpResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaPc,
        targetRootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift + 12,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaPc,
      targetRootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );

  const canStepTransposerDown = transposerSourceTab !== null && transposerNextDownResult.unavailableCount === 0;
  const canStepTransposerUp = transposerSourceTab !== null && transposerNextUpResult.unavailableCount === 0;
  const isTransposerBaseResetState =
    transposerSourceTab !== null && normalizePc(targetRootPc - harmonicaPc) === 0 && transposerOctaveOffset === 0;

  const transposerFollowEvaluation = useMemo(
    () =>
      evaluateTransposerFollow({
        enabled: isListening,
        tokens: transposerResult.playableTokens,
        state: transposerFollowState,
        detector: audioSnapshot,
        toneToleranceCents,
        minConfidence: toneFollowMinConfidence,
        noteSeparationRatio,
      }),
    // toneFollowTick drives periodic re-evaluation — include even though value unused in factory body
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isListening,
      transposerResult.playableTokens,
      transposerFollowState,
      audioSnapshot,
      toneToleranceCents,
      toneFollowMinConfidence,
      noteSeparationRatio,
      toneFollowTick,
    ],
  );

  useEffect(() => {
    const nextActiveIndex = transposerResult.playableTokens.length > 0 ? 0 : null;
    setTransposerFollowState(createTransposerFollowState(nextActiveIndex));
    setTransposerOutputTokenLayouts({});
  }, [transposerResult.playableTokens]);

  useEffect(() => {
    if (!isListening || transposerResult.playableTokens.length === 0) return;
    const intervalId = setInterval(() => {
      setToneFollowTick((prev) => prev + 1);
    }, 16);

    return () => clearInterval(intervalId);
  }, [isListening, transposerResult.playableTokens.length]);

  useEffect(() => {
    const nextState = transposerFollowEvaluation.state;
    if (
      nextState.activeTokenIndex === transposerFollowState.activeTokenIndex &&
      nextState.waitingForRelease === transposerFollowState.waitingForRelease &&
      nextState.peakRmsSinceAdvance === transposerFollowState.peakRmsSinceAdvance &&
      nextState.lastAmplitudeReleaseRms === transposerFollowState.lastAmplitudeReleaseRms
    ) {
      return;
    }
    setTransposerFollowState(nextState);
  }, [transposerFollowEvaluation.state, transposerFollowState]);

  useEffect(() => {
    const nextScrollY = ensureActiveTransposerTokenVisible({
      activeTokenIndex: transposerFollowState.activeTokenIndex,
      layouts: transposerOutputTokenLayouts,
      scrollY: transposerOutputScrollYRef.current,
      viewportHeight: transposerOutputViewportHeight,
    });
    if (nextScrollY === null || nextScrollY === transposerOutputScrollYRef.current) return;

    transposerOutputScrollRef.current?.scrollTo({ y: nextScrollY, animated: true });
    transposerOutputScrollYRef.current = nextScrollY;
  }, [
    transposerFollowState.activeTokenIndex,
    transposerOutputTokenLayouts,
    transposerOutputViewportHeight,
  ]);

  function moveTransposerCursor(tokenIndex: number) {
    setTransposerFollowState(createTransposerFollowState(tokenIndex));
  }

  return {
    transposerFollowState,
    transposerOutputViewportHeight,
    setTransposerOutputViewportHeight,
    transposerOutputTokenLayouts,
    setTransposerOutputTokenLayouts,
    transposerOutputScrollRef,
    transposerOutputScrollYRef,
    transposerSourceTab,
    transposerBaseShift,
    transposerResult,
    transposerNextDownResult,
    transposerNextUpResult,
    transposerDisplayShift,
    canStepTransposerDown,
    canStepTransposerUp,
    isTransposerBaseResetState,
    transposerFollowEvaluation,
    moveTransposerCursor,
  };
}

function ensureActiveTransposerTokenVisible(params: {
  activeTokenIndex: number | null;
  layouts: Record<number, { y: number; height: number }>;
  scrollY: number;
  viewportHeight: number;
}): number | null {
  const { activeTokenIndex, layouts, scrollY, viewportHeight } = params;
  if (activeTokenIndex === null || viewportHeight <= 0) return null;

  const layout = layouts[activeTokenIndex];
  if (!layout) return null;

  const visibleTop = scrollY + TRANSPOSER_OUTPUT_SCROLL_PADDING;
  const visibleBottom = scrollY + viewportHeight - TRANSPOSER_OUTPUT_SCROLL_PADDING;
  const tokenTop = layout.y;
  const tokenBottom = layout.y + layout.height;

  if (tokenTop < visibleTop) {
    return Math.max(0, tokenTop - TRANSPOSER_OUTPUT_SCROLL_PADDING);
  }

  if (tokenBottom > visibleBottom) {
    return Math.max(0, tokenBottom - viewportHeight + TRANSPOSER_OUTPUT_SCROLL_PADDING);
  }

  return null;
}
