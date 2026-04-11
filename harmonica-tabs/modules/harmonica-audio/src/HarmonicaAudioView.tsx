import { requireNativeView } from 'expo';
import * as React from 'react';

import { HarmonicaAudioViewProps } from './HarmonicaAudio.types';

const NativeView: React.ComponentType<HarmonicaAudioViewProps> =
  requireNativeView('HarmonicaAudio');

export default function HarmonicaAudioView(props: HarmonicaAudioViewProps) {
  return <NativeView {...props} />;
}
