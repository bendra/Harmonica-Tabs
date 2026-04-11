import * as React from 'react';

import { HarmonicaAudioViewProps } from './HarmonicaAudio.types';

export default function HarmonicaAudioView(props: HarmonicaAudioViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
