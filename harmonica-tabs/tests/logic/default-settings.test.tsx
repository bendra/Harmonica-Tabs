import React from 'react';
import { describe, expect, it } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_MUSICAL_SELECTION } from '../../src/config/default-settings';
import { useAudioSettings } from '../../src/hooks/use-audio-settings';
import { useMusicalSelection } from '../../src/hooks/use-musical-selection';

type HookSnapshot = {
  audio: ReturnType<typeof useAudioSettings>;
  musical: ReturnType<typeof useMusicalSelection>;
};

describe('shared default settings', () => {
  it('initializes the settings hooks from the shared defaults module', () => {
    let snapshot: HookSnapshot | null = null;

    function Probe() {
      snapshot = {
        audio: useAudioSettings(),
        musical: useMusicalSelection(),
      };
      return null;
    }

    act(() => {
      TestRenderer.create(<Probe />);
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.audio.showDebug).toBe(DEFAULT_AUDIO_SETTINGS.showDebug);
    expect(snapshot!.audio.toneToleranceInput).toBe(DEFAULT_AUDIO_SETTINGS.toneToleranceInput);
    expect(snapshot!.audio.toneToleranceCents).toBe(DEFAULT_AUDIO_SETTINGS.toneToleranceCents);
    expect(snapshot!.audio.toneFollowMinConfidenceInput).toBe(DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidenceInput);
    expect(snapshot!.audio.toneFollowMinConfidence).toBe(DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence);
    expect(snapshot!.audio.simFrequency).toBe(DEFAULT_AUDIO_SETTINGS.simFrequencyInput);
    expect(snapshot!.musical.harmonicaKey.pc).toBe(DEFAULT_MUSICAL_SELECTION.harmonicaKeyPc);
    expect(snapshot!.musical.harmonicaKeyLabelStyle).toBe(DEFAULT_MUSICAL_SELECTION.harmonicaKeyLabelStyle);
    expect(snapshot!.musical.targetKeyLabelStyle).toBe(DEFAULT_MUSICAL_SELECTION.targetKeyLabelStyle);
    expect(snapshot!.musical.notation).toBe(DEFAULT_MUSICAL_SELECTION.notation);
    expect(snapshot!.musical.positionKeyFilter).toBe(DEFAULT_MUSICAL_SELECTION.positionKeyFilter);
    expect(snapshot!.musical.gAltPreference).toBe(DEFAULT_MUSICAL_SELECTION.gAltPreference);
  });
});
