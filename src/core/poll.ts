import type { StatusResponse } from "./contract.js";

/**
 * The result of one status probe, classified into the three outcomes the state
 * machine cares about.
 */
export type StatusOutcome =
  | { kind: "authenticated"; account: string }
  | { kind: "logged_out" } // definitive: 401 or {ok:false,status:'logged_out'}
  | { kind: "pending" } // 200 {ok:false} — keep waiting, do NOT sign out
  | { kind: "transient" }; // 5xx / network blip — tolerate with backoff

/** Classify an HTTP status + body into a StatusOutcome. */
export function classifyStatus(
  httpStatus: number,
  body: StatusResponse | null,
): StatusOutcome {
  if (httpStatus === 401) return { kind: "logged_out" };
  if (httpStatus >= 500 || httpStatus === 0) return { kind: "transient" };
  if (body && body.ok === true) return { kind: "authenticated", account: body.account };
  if (body && body.ok === false && body.status === "logged_out") {
    return { kind: "logged_out" };
  }
  // 200 {ok:false} (pending) or anything else non-definitive
  return { kind: "pending" };
}

export interface PollerOptions {
  /** Probe once; resolves to an outcome. Implemented by the core client. */
  probe: () => Promise<StatusOutcome>;
  intervalMs?: number;
  /** Absolute epoch-ms deadline; past it the poller emits onExpired and stops. */
  getExpiresAt?: () => number | null;
  /** Local clock source (injectable for tests). Defaults to Date.now. */
  now?: () => number;
  maxConsecutiveFailures?: number;
  onAuthenticated: (account: string) => void;
  onLoggedOut: () => void;
  onExpired: () => void;
  onFailed: () => void;
}

export interface Poller {
  start: () => void;
  stop: () => void;
  /** Probe immediately (used by the visibilitychange handler). Reentrancy-guarded. */
  pokeNow: () => void;
  isRunning: () => boolean;
}

/**
 * Status poller. Per review hardening:
 *   - reentrancy guard: an interval tick and a visibility re-poke never overlap
 *   - bounded: stops past expiresAt (onExpired) and after N consecutive failures (onFailed)
 *   - debounced visibility poke
 *   - signs out only on a definitive logged_out outcome, never on `pending`
 *   - start() is idempotent
 */
export function createPoller(opts: PollerOptions): Poller {
  const intervalMs = opts.intervalMs ?? 3000;
  const maxFailures = opts.maxConsecutiveFailures ?? 5;
  const now = opts.now ?? (() => Date.now());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight = false;
  let failures = 0;
  let lastPoke = 0;

  const schedule = () => {
    if (!running) return;
    timer = setTimeout(tick, intervalMs);
  };

  const expired = () => {
    const exp = opts.getExpiresAt?.() ?? null;
    return exp != null && now() > exp;
  };

  async function tick(): Promise<void> {
    if (!running || inFlight) return;
    if (expired()) {
      stop();
      opts.onExpired();
      return;
    }
    inFlight = true;
    try {
      const outcome = await opts.probe();
      switch (outcome.kind) {
        case "authenticated":
          stop();
          opts.onAuthenticated(outcome.account);
          return;
        case "logged_out":
          stop();
          opts.onLoggedOut();
          return;
        case "transient":
          // a reachable-but-erroring backend counts toward the failure ceiling
          failures += 1;
          break;
        case "pending":
        default:
          // a successful "still waiting" probe resets the failure streak
          failures = 0;
          break;
      }
    } catch {
      failures += 1;
    } finally {
      inFlight = false;
    }

    if (failures >= maxFailures) {
      stop();
      opts.onFailed();
      return;
    }
    schedule();
  }

  function start(): void {
    if (running) return; // idempotent
    running = true;
    failures = 0;
    // first probe immediately
    void tick();
  }

  function stop(): void {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function pokeNow(): void {
    if (!running) return;
    // debounce rapid visibility toggles
    const t = now();
    if (t - lastPoke < 500) return;
    lastPoke = t;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void tick();
  }

  return { start, stop, pokeNow, isRunning: () => running };
}
