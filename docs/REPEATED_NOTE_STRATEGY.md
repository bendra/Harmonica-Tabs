## Harmonica Real-Time Pitch Tracking & Tab-Follower Strategy
Core Challenge:
Harmonica audio is "dirty" signal. Real-time tracking is complicated by mechanical artifacts (tuts, guhs, throat coughs), "pitchy" reed behavior (bending/vibrato), and the lack of duration data in tabs.
------------------------------
## 1. Signal Pre-Processing (The "Cleaner")

* High-Pass Filtering: Apply a steep cut below 150–200Hz. This removes sub-bass "thumps" and breath noise (e.g., the "MIDI 10" error) without affecting musical notes.
* Buffer Strategy: Use a small rolling consensus buffer (e.g., 25–50ms). This allows the system to look for a "majority vote" on pitch, smoothing out momentary wobbles (e.g., flickering between Bb and B).

## 2. The "Aggressive First Guess" (Optimistic UI)
To eliminate perceived latency, split the detection into two paths:

* The Fast Path (Prediction): Trigger a UI highlight the instant an onset (volume spike) or pitch shift is detected. Use the Tab Context as a cheat sheet—if the next note in the tab is Hole 5, assume a sudden shift is that note.
* The Slow Path (Confirmation): After ~30ms of additional data, verify the pitch.
* Success: "Lock" the UI highlight (e.g., change from dim to bright).
   * Failure: Fade out the "guess" highlight. This prevents "sea-sick" UI jumps while feeling instantaneous to the player.

## 3. Managing Complex Articulation
To distinguish between intentional note repeats and single-note fluctuations:

* The "OR" Trigger: A new note is triggered if EITHER a sharp volume dip/rise occurs (staccato repeats on one hole) OR the pitch crosses a specific semi-tone boundary (slides/bends/button presses).
* Hysteresis (Debouncing): Require a new pitch to remain stable for a minimum number of frames before confirming a "slide," preventing deep vibrato from being misidentified as rapid note changes.

## 4. Key Logic Principles

* Temporal Masking: Ignore the first 5–10ms of a new sound to skip the "unpitched" air noise of the attack.
* Note Persistence: Since tabs lack duration, keep Note A highlighted until the system is confident that Note B has started.
* State Machine: Maintain states for Searching, Locked, and Correction to handle the fluidity of musical performance vs. the rigidity of data.



