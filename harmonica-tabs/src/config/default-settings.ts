import { noteToPc } from '../data/notes';

export const DEFAULT_MUSICAL_SELECTION = {
  harmonicaKeyPc: noteToPc('C'),
  harmonicaKeyLabelStyle: 'standard',
  targetKeyLabelStyle: 'flat',
  notation: 'apostrophe',
  positionKeyFilter: '1-2-3',
  gAltPreference: '-2',
} as const;

export const AUDIO_SETTINGS_LIMITS = {
  toneToleranceCents: {
    min: 1,
    max: 120,
  },
  toneFollowMinConfidence: {
    min: 0,
    max: 1,
  },
} as const;

export const DEFAULT_AUDIO_SETTINGS = {
  showDebug: false,
  toneToleranceInput: '60',
  toneToleranceCents: 60,
  toneFollowMinConfidenceInput: '0.35',
  toneFollowMinConfidence: 0.35,
  simFrequencyInput: '440',
  signalHoldMs: 400,
  confidenceGate: 0.2,
} as const;
