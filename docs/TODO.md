# TODO / Next Steps

- Revisit tab ordering and octave handling if alternate tunings are added.
- Consider exposing chord logic as a pure helper to test more directly.
- Improve UI responsiveness so it's more effective on different screen sizes
- Revisit `-2` vs `3` toggle behavior for chord visualization.
- Expand transposer parser support for more legacy tab notations (if needed).
- Add copy/share actions for transposer output.
- Add some way to save tabs, with the exact storage/UX still to be decided.
- Consider whether the transposer's explicit `Paste` action should grow into a fuller clipboard/edit menu.
- Add native (iOS/Android) detector producers that feed the same shared detector snapshot used by tone follow.
- Consolidate repeated UI/runtime default values into shared default-setting constants so input defaults and fallback values stay in sync.
- Persist transposer cleanup preferences across sessions.
- Persist tone-follow settings across sessions if they prove useful.
- Consider persisting the transposer keyboard choice across sessions if users ask for it.
- Consider a helper hint for the transposer `Clean Input` flow beyond the current mobile pad guidance.
- data persistence (web and native)
- accessability
- localization
