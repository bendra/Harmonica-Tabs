# WebView Audio Spike

## Goal

Test whether an iOS WebView can reproduce the same reliable microphone input that
iPad Safari provides for the web app, without replacing the native UI.

The spike is now validated on iPad and promoted to the default iOS audio path.
The native AVAudioEngine path remains available as a temporary debug fallback.

## Implementation Status

Implemented as a detector-only iOS path behind the temporary Properties
`Audio source (debug)` dropdown. `WebView` is the iOS default; selecting
`Native` switches back to the AVAudioEngine path for comparison/fallback.
The WebView path mounts a hidden `HarmonicaAudioView`, loads a bundled
WKWebView detector page from the iOS module resources, runs 4096-sample Web
Audio/YIN detection there, and forwards pitch updates into the existing shared
`useAudioListening` path as `listenSource: 'webview'`.

On-device iPad validation passed on 2026-05-25: the WebView path responded like
the web app in Scales/Tabs follow and correctly handled the known high-note and
low-guard-note cases called out below.

## Current Evidence

- iPad Safari over HTTPS detects the known C-harmonica high notes correctly.
- The native app using `AVAudioEngine` in `.default` mode still produces some
  octave-low YIN frames.
- Switching native iOS capture to `.measurement` made practical detection worse,
  so that mode should stay reverted unless a later experiment proves otherwise.
- `HarmonicaAudioView` now registers a usable iOS detector view with native
  props, WKWebView script-message events, microphone media-capture permission
  handling, and pitch updates back to React Native. Android remains native-only
  for this spike.
- The bundled detector page is stored as `webview-detector.html` in the iOS
  module resources and loaded with `https://harmonica-tabs.local/` as the base
  URL so WKWebView keeps the secure-origin behavior required by `getUserMedia`.

## Spike Shape

1. Keep the existing React Native UI and audio store.
2. Add a separate hidden/diagnostic WebView detector path behind a temporary
   debug switch or hard-coded spike flag.
3. Load a minimal HTTPS or bundled HTML page that calls
   `navigator.mediaDevices.getUserMedia({ audio: true })`.
4. Run the same web detector logic or a tiny equivalent detector bundle inside
   that page.
5. Send pitch updates to React Native through `postMessage` using the same
   update shape as `createWebAudioPitchDetector`.
6. Feed those updates into the existing `useAudioListening` path so the debug
   panel and UI can compare `Source: Mic input (webview)` against native/web.

## Success Criteria

- iOS shows a microphone permission prompt inside the native app.
- C-harmonica `6`, `-7`, and `8` detect in the correct octave on the same iPad.
- Low guard notes `1`, `-1`, `2`, `-2`, `3`, and `4` do not shift upward.
- Latency is close enough for the existing Scales and Tabs follow behavior.

## Stop Conditions

- `navigator.mediaDevices.getUserMedia` is unavailable in the WebView.
- iOS refuses microphone capture for the loaded origin/context.
- PostMessage latency or lifecycle behavior is worse than the current native
  bridge.

If the spike fails, the next native route should be exporting short PCM fixtures
from the current Swift capture path for offline spectral comparison before any
more detector threshold tuning.
