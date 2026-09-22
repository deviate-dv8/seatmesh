/**
 * Per-step error isolation for the drain-tick loop (see mesh-orchestrator.ts).
 * Border-paint runs last in that tick; without this, an exception in any earlier
 * step (inbox/peer/checkback/target/ack draining) silently skipped painting for
 * the whole tick — a persistent (not just transient) failure there would freeze
 * every pane's banner with no signal why. That's the daemon-diagnosability gap
 * TODO 7.6 was about, showing up in a different spot.
 *
 * Log once per step label per LOG_THROTTLE_MS, not every tick — a step that
 * throws on every tick must not spam the log into uselessness.
 */
const LOG_THROTTLE_MS = 60_000;

export function createStepErrorLog(): {
  runStep: <T>(label: string, fallback: T, fn: () => T, log: (line: string) => void) => T;
  runStepAsync: <T>(
    label: string,
    fallback: T,
    fn: () => Promise<T> | T,
    log: (line: string) => void,
  ) => Promise<T>;
} {
  const lastLogAt = new Map<string, number>();

  function noteError(label: string, e: unknown, log: (line: string) => void, now: number): void {
    const last = lastLogAt.get(label) ?? 0;
    if (now - last > LOG_THROTTLE_MS) {
      lastLogAt.set(label, now);
      log(`drain-tick step "${label}" threw: ${(e as Error).message} (continuing)`);
    }
  }

  return {
    runStep(label, fallback, fn, log) {
      try {
        return fn();
      } catch (e) {
        noteError(label, e, log, Date.now());
        return fallback;
      }
    },
    async runStepAsync(label, fallback, fn, log) {
      try {
        return await fn();
      } catch (e) {
        noteError(label, e, log, Date.now());
        return fallback;
      }
    },
  };
}
