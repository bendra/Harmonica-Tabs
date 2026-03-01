# Harmonica Scale Visualizer - Draft Requirements

Date: 2026-02-17
Owner: User

## 1. Overview
A cross‑platform app (iOS/Android/Web) to quickly visualize playable scales and chords on a 10‑hole diatonic harmonica in a chosen key. The app helps players respond to unexpected keys by showing blow/draw/bend/overbend tablature for selected scales on the selected harmonica.

## 2. Goals
- Fast, clear visualization of scale/chord layouts for a chosen harmonica key.
- Minimal setup: single screen, quick selection, immediate results.
- Cross‑platform from day one.
- Real‑time tone recognition using device microphone, with visual feedback on the tab list.

## 3. Non‑Goals (for MVP)
- User accounts or cloud sync.
- Audio playback or tuning tools beyond tone recognition.
- Advanced customization of tunings beyond standard Richter layout.

## 4. Target Users
- Primarily the owner (intermediate player).
- Other diatonic harmonica players who need quick reference for unexpected keys.

## 5. MVP User Flow
1. Open app.
2. Select harmonica key (e.g., C, A, Bb).
3. Select one or more scales/chords (e.g., A major, C minor, Bb blues minor).
4. See color‑coded tablature list (blow/draw/bend/overbend) for each selected scale on the selected harmonica.
5. Tap “Listen” to start tone recognition and see the current detected pitch highlighted relative to the displayed tabs.

## 6. Core Screen (MVP)
Single main screen with:
- Key selector for harmonica key.
- Scale selection area with search + add to manage multiple scales.
- Results list showing tablature for each scale.
- A “Listen” control to start/stop tone recognition, with a small status readout (e.g., “A4 • 440 Hz” or “No signal”).

## 7. Data & Logic (MVP)
### 7.1 Harmonica Layout
- Standard 10‑hole Richter diatonic layout.
- Notes per hole for blow/draw/bend/overbend.

### 7.2 Scales/Chords
- Scale definitions stored as interval formulas (e.g., major, natural minor, blues minor).
- Mapping logic: scale intervals → notes in key → hole/technique mapping.
- Note spelling uses the selected harmonica key (e.g., Bb harmonica prefers `Bb` over `A#`).

### 7.3 Tablature Notation
- Blow notes are written as the hole number (e.g., `4`).
- Draw notes are written with a leading minus (e.g., `-4`).
- Bends use trailing apostrophes for semitone steps (e.g., `-3'` for 1 semitone, `-3''` for 2 semitones).
- Overbends are supported in two user‑selectable notations:
  - Trailing degree symbol (e.g., `6°` or `-7°`).
  - Trailing apostrophes with context (overblow on holes 1–6, overdraw on holes 7–10).
- The UI must let the user choose the preferred overbend notation.
- Example (C major scale): `1 -1 2 -2'' -2 -3'' -3 4 -4 5 -5 6 -6 -7 7 -8 8 -9 9 -10 10' 10`.
- Example (D minor scale): `-1 2 -2'' 3 -3'' -3' 4 -4 5 -5 6 -6 6' 7 -8 8 -9 9 -10 10'' 10 -10'`.
- Example (D minor scale, degree symbol overbends): `-1 2 -2'' 3 -3'' -3' 4 -4 5 -5 6 -6 6° 7 -8 8 -9 9 -10 10° 10 -10°`.

### 7.4 Technique Constraints (Standard 10‑Hole Richter)
- Draw bends are possible on holes 1–6.
- Blow bends are possible on holes 8–10.
- Overblows are possible on holes 1–6 (no overblows on holes 7–10).
- Overdraws are possible on holes 7–10 (no overdraws on holes 1–6).
- Overbends on holes 2, 3, and 8 are excluded from suggestions (tones are more easily available elsewhere).
- The app must not emit impossible techniques for a given hole.
- These constraints apply to standard Richter tuning; alternative tunings may be supported later.

### 7.5 Pitch Range Assumptions (Standard Richter)
- C harmonica range (including hole 10 overdraw): C4 to C#7.
- G harmonica range (lowest standard harp): G3 to G#6.
- F# harmonica range (highest standard harp): F#4 to G7.

### 7.6 Tone Recognition (MVP)
- Use the device microphone as the audio input.
- Perform real‑time pitch detection on the client (no server dependency).
- Do not show raw note names (e.g., `A4`) in the UI. The user cares about which scale tab is being played.
- Map detected pitch to the closest matching tab in the currently displayed list and place a floating caret between neighboring tabs:
  - Find the two adjacent tabs by pitch (`left`, `right`) that bracket the detected frequency.
  - Position the caret proportionally **in cents** (log frequency), not linear Hz, between the two tabs.
  - If the pitch is below/above the displayed range, pin the caret to the first/last tab.
  - If multiple tabs share the same pitch, treat them as a single stop for caret placement.
- Provide clear “no signal” and “too noisy” states when pitch confidence is low.

## 8. UX Requirements
- Fast, legible, and color‑coded.
- Clearly distinguish blow vs draw vs bend vs overbend.
- Immediate updates on selection changes.
- While listening, highlight the detected tab and keep it visible in the list (auto‑scroll to it if needed).
- Listening state must be obvious and easy to toggle off.

## 9. Platform & Tech
- Cross‑platform from day one.
- Recommended stack: React Native + Expo + TypeScript.
- Use a cross‑platform audio input + pitch detection library compatible with React Native/Expo (exact choice TBD).

## 10. Open Decisions
- Source/reference for harmonica note mapping (standard Richter assumed unless provided).
- Visual styling preferences (fonts, color palette).
- Pitch detection library choice and microphone permission flow.
- Exact highlighting behavior when multiple tabs share the same pitch.

## 11. Future Ideas (Post‑MVP)
- Favorites or saved scale sets.
- Alternate tunings.
- Audio playback of scale.
- Practice mode or chord suggestions.
