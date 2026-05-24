import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  PersistedPreferences,
  savePreferences,
} from '../logic/preferences';

const SAVE_DEBOUNCE_MS = 250;

export type PersistedPreferencesLoadState = {
  ready: boolean;
  initialPreferences: PersistedPreferences;
};

/**
 * Reads the persisted preferences blob once on mount. Returns DEFAULT_PREFERENCES
 * with `ready: false` until the load resolves. Callers should gate their
 * stateful initialization on `ready === true` so the initial render uses the
 * persisted values rather than the defaults (avoids a flash).
 */
export function usePersistedPreferences(): PersistedPreferencesLoadState {
  const [state, setState] = useState<PersistedPreferencesLoadState>({
    ready: false,
    initialPreferences: DEFAULT_PREFERENCES,
  });

  useEffect(() => {
    let cancelled = false;
    loadPreferences()
      .then((initialPreferences) => {
        if (cancelled) return;
        setState({ ready: true, initialPreferences });
      })
      .catch(() => {
        if (cancelled) return;
        // On any unexpected load failure, fall through to defaults so the app
        // still becomes interactive.
        setState({ ready: true, initialPreferences: DEFAULT_PREFERENCES });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Writes `preferences` to storage whenever the serialized value changes,
 * debounced. The hook is initialized with the current serialized value treated
 * as already-persisted, so the first render is a no-op (we just hydrated from
 * storage, so there is nothing to write). Subsequent renders that produce a
 * different serialized value schedule a debounced save.
 *
 * Pass `enabled = false` to fully suppress writes (useful when hydration is
 * still in progress in a parent and we don't want to clobber the stored blob).
 */
export function usePersistPreferencesEffect(preferences: PersistedPreferences, enabled: boolean): void {
  const serialized = JSON.stringify(preferences);
  // Treat the value seen on first render as already-persisted. Any later
  // change in the serialized value will diverge from this and trigger a save.
  const lastWrittenRef = useRef<string>(serialized);

  useEffect(() => {
    if (!enabled) return;
    if (lastWrittenRef.current === serialized) return;

    const timeoutId = setTimeout(() => {
      lastWrittenRef.current = serialized;
      savePreferences(JSON.parse(serialized) as PersistedPreferences).catch(() => {
        // Storage write failures are non-fatal; the next change attempt will retry.
      });
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [serialized, enabled]);
}
