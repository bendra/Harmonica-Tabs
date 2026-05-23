/**
 * Pure helpers for the native audio path, split out so they can be unit-tested.
 * `native-audio.ts` pulls in `requireNativeModule` at load time and cannot be
 * imported under Vitest, so the testable logic lives here instead.
 */

/**
 * True when a captured frame is too old to bother processing.
 *
 * - Frames with no timestamp (`null`) always pass — safety net for any path
 *   that doesn't stamp `capturedAt`.
 * - The boundary is exclusive: a frame exactly `staleMs` old still passes;
 *   only strictly older frames are dropped.
 */
export function isStaleFrame(
  capturedAtMs: number | null,
  nowMs: number,
  staleMs: number,
): boolean {
  return capturedAtMs != null && nowMs - capturedAtMs > staleMs;
}
