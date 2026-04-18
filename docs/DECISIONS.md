# Decisions Log

Use this document to capture implementation decisions and rationale.

## Tone Recognition

1. Audio stack (Expo managed vs custom dev client/native modules):
   - Answer: Since the UI is very small a slightly less accurate solution will probably work fine. Start with this and see if it works well enough. Keep Expo managed and try `expo-audio-studio` first for Phase 2.

2. Pitch detection approach (JS-only vs native):
   - Answer: JS only for now

3. Pitch detection algorithm (YIN vs autocorrelation vs other):
   - Answer: FFT-based YIN (`yinfft` variant, as used by the aubio library). Autocorrelation was the original choice but was replaced after testing showed it failed on harmonica audio: strong 2nd harmonics inflate the time-domain running sum at the true fundamental's lag, pushing CMND above 1 and making detection impossible. The FFT-based autocorrelation avoids this — the autocorrelation is computed globally across the spectrum so harmonics reinforce rather than suppress the fundamental. Goertzel is still used for chord detection (where scoring multiple frequencies simultaneously is the goal).

4. Frequency-to-tab mapping details (tolerance, tie-breaking, between-tabs behavior):
   - Answer: Place the caret between the two neighboring tabs by pitch and position it proportionally using cents (log frequency), not linear Hz. If the detected frequency falls between `f_low` and `f_high`, compute `t = (c - c_low) / (c_high - c_low)` where `c = 1200 * log2(f / 440) + 6900`, and place the caret at `t` between those two chips. If below/above the displayed range, pin to the ends. If multiple tabs share a pitch, treat them as one stop for caret placement.
   - Visual in-tune threshold: If the detected pitch is within +/-10 cents of the matched row note, the floating circle turns bright green.

5. UI indicator for “between tabs” (e.g., floating caret):
   - Answer: Floating caret

## Notes
- Transposer first-position behavior: selecting first position should no longer be a no-op. It now means "shift by one octave" in the selected direction, while the screen still defaults to the cleaner of down-octave or up-octave output when it can.
- Web-first is acceptable because caret placement is coarse-grained, but stability matters more than latency. We should smooth pitch estimates to avoid jitter even if latency is higher.
