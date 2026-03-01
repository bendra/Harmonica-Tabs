# Decisions Log

Use this document to capture implementation decisions and rationale.

## Tone Recognition

1. Audio stack (Expo managed vs custom dev client/native modules):
   - Answer: Since the UI is very small a slightly less accurate solution will probably work fine. Start with this and see if it works well enough. Keep Expo managed and try `expo-audio-studio` first for Phase 2.

2. Pitch detection approach (JS-only vs native):
   - Answer: JS only for now

3. Pitch detection algorithm (YIN vs autocorrelation vs other):
   - Answer: Try Autocorrelation and see if that's good enough. then re-evaluate if neccesary

4. Frequency-to-tab mapping details (tolerance, tie-breaking, between-tabs behavior):
   - Answer: Place the caret between the two neighboring tabs by pitch and position it proportionally using cents (log frequency), not linear Hz. If the detected frequency falls between `f_low` and `f_high`, compute `t = (c - c_low) / (c_high - c_low)` where `c = 1200 * log2(f / 440) + 6900`, and place the caret at `t` between those two chips. If below/above the displayed range, pin to the ends. If multiple tabs share a pitch, treat them as one stop for caret placement.

5. UI indicator for “between tabs” (e.g., floating caret):
   - Answer: Floating caret

## Notes
- Web-first is acceptable because caret placement is coarse-grained, but stability matters more than latency. We should smooth pitch estimates to avoid jitter even if latency is higher.
