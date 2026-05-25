import React, { useSyncExternalStore } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { HarmonicaVocabulary } from './harmonica-frequencies';
import { SingleNoteResult } from './fft-detector';

type PitchUpdateHandler = (update: SingleNoteResult) => void;

type WebViewDetectorState = {
  active: boolean;
  vocabularyJson: string;
};

const INITIAL_STATE: WebViewDetectorState = {
  active: false,
  vocabularyJson: '',
};

let state = INITIAL_STATE;
let onUpdateRef: PitchUpdateHandler | null = null;
let startResolve: (() => void) | null = null;
let startReject: ((error: Error) => void) | null = null;
const listeners = new Set<() => void>();

function serializeVocabulary(vocabulary: HarmonicaVocabulary): string {
  return JSON.stringify({
    allNotes: vocabulary.allNotes.map((note) => ({
      midi: note.midi,
      frequency: note.frequency,
      confidenceThreshold: note.confidenceThreshold,
    })),
  });
}

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(nextState: WebViewDetectorState) {
  state = nextState;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function completeStart() {
  startResolve?.();
  startResolve = null;
  startReject = null;
}

function failStart(message: string) {
  const error = new Error(message || 'WebView audio detector unavailable');
  startReject?.(error);
  startResolve = null;
  startReject = null;
}

export function createWebViewAudioPitchDetector() {
  function isSupported(): boolean {
    return Platform.OS === 'ios';
  }

  async function start(onUpdate: PitchUpdateHandler, vocabulary: HarmonicaVocabulary) {
    if (!isSupported()) {
      throw new Error('WebView audio is only supported on iOS for this spike');
    }

    onUpdateRef = onUpdate;
    setState({ active: true, vocabularyJson: serializeVocabulary(vocabulary) });

    await new Promise<void>((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
    });
  }

  function stop() {
    onUpdateRef = null;
    completeStart();
    setState({ active: false, vocabularyJson: state.vocabularyJson });
  }

  function updateVocabulary(vocabulary: HarmonicaVocabulary) {
    setState({ ...state, vocabularyJson: serializeVocabulary(vocabulary) });
  }

  function setMinSendIntervalMs(_ms: number) {}

  return { isSupported, start, stop, updateVocabulary, setMinSendIntervalMs };
}

export function WebViewAudioDetectorHost() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (Platform.OS !== 'ios' || (!snapshot.active && !snapshot.vocabularyJson)) {
    return null;
  }

  const HarmonicaAudioView = require('../../modules/harmonica-audio/src/HarmonicaAudioView').default;
  return (
    <HarmonicaAudioView
      testID="webview-audio-detector-host"
      active={snapshot.active}
      vocabularyJson={snapshot.vocabularyJson}
      onWebViewDetectorReady={() => completeStart()}
      onWebViewDetectorError={(event: { nativeEvent: { message?: string } }) => {
        failStart(event.nativeEvent.message ?? 'WebView audio detector unavailable');
      }}
      onWebViewPitchUpdate={(event: { nativeEvent: SingleNoteResult }) => {
        onUpdateRef?.(event.nativeEvent);
      }}
      style={styles.hiddenWebView}
    />
  );
}

const styles = StyleSheet.create({
  hiddenWebView: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
