# Harmonica Tabs

A cross-platform app to visualize playable scales and chords on a 10-hole diatonic (Richter-tuned) harmonica. Select a harmonica key and a scale, then see the blow/draw/bend tablature for quick reference.

## Getting Started

Install dependencies (from the repo root):

```bash
cd harmonica-tabs
npm install
```

Start the development server:

```bash
npm run start
```

Run on web:

```bash
npm run web
```

Run on Android (requires Android Studio / emulator):

```bash
npm run android
```

Run on iOS Simulator (requires macOS and Xcode):

```bash
npm run ios
```

## Quick iPhone Test with Expo Go

If you want the fastest real-device check on iPhone, use Expo Go first.
This is the easiest path because you do not need to create an Xcode project or make an installable build yet.

1. Install `Expo Go` from the App Store on your iPhone.
2. Make sure your iPhone and the computer running this repo are on the same Wi-Fi network.
3. From the repo root, start the Expo dev server:

```bash
cd harmonica-tabs
npm install
npm run start
```

4. Scan the QR code from the Expo terminal or browser page with your iPhone.
5. The app should open inside Expo Go.

If the QR flow does not work on your network, try:

```bash
cd harmonica-tabs
npx expo start --tunnel
```

`--tunnel` is often more reliable on restricted networks, but it can be slower.

For this project, Expo Go on iPhone is the best first pass for checking:

- layout and spacing on a real phone
- navigation between `Scales`, `Tabs`, and the editor overlay
- scrolling behavior
- keyboard behavior in the editor
- saved-tab persistence and general app flow

Important current limitation:

- Real microphone detection is still web-only in this repo today.
- Native iPhone testing is useful now for UI and app behavior, but not yet for validating native tone-follow audio input.

If you later need custom native behavior or a more production-like install, the next step would be a development build or installable iOS build rather than Expo Go.

## Stopping the Server

Press `Ctrl+C` in the terminal running the Expo server.

## Tests

```bash
cd harmonica-tabs
npm test
```
