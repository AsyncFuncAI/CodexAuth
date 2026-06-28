import type {
  CodexClientConfig,
  CodexAuthSnapshot,
  EndpointMap,
  LoginStartResponse,
  SessionResponse,
  StatusResponse,
} from "./contract.js";
import { resolveEndpoints } from "./endpoints.js";
import {
  transition,
  initialSnapshot,
  type CodexAuthEvent,
} from "./stateMachine.js";
import { classifyStatus, createPoller, type Poller, type StatusOutcome } from "./poll.js";
import { createPersistence, type Persistence } from "./persistence.js";
import { pointPopupTo, closePopup } from "./popup.js";
import { createRunClient, type RunHandlers, type RunController } from "./run.js";

export interface CodexClient {
  getState: () => CodexAuthSnapshot;
  subscribe: (cb: (s: CodexAuthSnapshot) => void) => () => void;
  /** Always POSTs /session (idempotent backend). The HttpOnly cookie is unreadable client-side. */
  ensureSession: () => Promise<void>;
  startLogin: () => Promise<LoginStartResponse>;
  pollStatus: () => Promise<StatusOutcome>;
  startPolling: () => void;
  /** Leave waitingForLogin without a backend logout. */
  cancelLogin: () => void;
  logout: () => Promise<void>;
  resumeFromStorage: () => Promise<boolean>;
  run: (prompt: string, handlers?: RunHandlers) => RunController;
  /** Register the popup ref so the client can point/close it. Null = blocked. */
  attachPopup: (popup: Window | null) => void;
  destroy: () => void;
  isDestroyed: () => boolean;
  readonly endpoints: EndpointMap;
}

export function createCodexClient(config: CodexClientConfig = {}): CodexClient {
  const endpoints = resolveEndpoints(config);
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const credentials = config.credentials ?? "same-origin";
  const allowedHosts = config.allowedLoginHosts;
  const persistence: Persistence = createPersistence({
    storage: config.storage,
    storageKey: config.storageKey,
    resumeMaxAgeMs: config.resumeMaxAgeMs,
  });
  const runClient = createRunClient(config);

  let state = initialSnapshot;
  const listeners = new Set<(s: CodexAuthSnapshot) => void>();
  let popup: Window | null = null;
  let poller: Poller | null = null;
  let visibilityHandler: (() => void) | null = null;
  let destroyed = false;

  const emit = () => {
    for (const cb of listeners) cb(state);
  };
  const dispatch = (event: CodexAuthEvent) => {
    if (destroyed) return;
    const next = transition(state, event);
    if (next !== state) {
      state = next;
      emit();
    }
  };

  async function getJson<T>(
    url: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: T | null }> {
    try {
      const resp = await fetchImpl(url, { credentials, ...init });
      let body: T | null = null;
      try {
        body = (await resp.json()) as T;
      } catch {
        /* empty / non-json body */
      }
      return { status: resp.status, body };
    } catch {
      return { status: 0, body: null }; // network error
    }
  }

  async function ensureSession(): Promise<void> {
    // ALWAYS call /session — the HttpOnly cookie cannot be read client-side, so
    // there is no "check if cookie exists" path. The backend makes it idempotent.
    const { status, body } = await getJson<SessionResponse>(endpoints.session, {
      method: "POST",
    });
    if (status === 0) {
      dispatch({ type: "ERROR", error: { code: "NETWORK", message: "Could not reach the server." } });
      throw new Error("network");
    }
    if (!body || body.ok !== true) {
      const msg = body && "error" in body ? body.error : "Could not start a session.";
      dispatch({ type: "ERROR", error: { code: "SESSION_FAILED", message: msg } });
      throw new Error(msg);
    }
  }

  async function startLogin(): Promise<LoginStartResponse> {
    const { status, body } = await getJson<LoginStartResponse>(endpoints.loginStart, {
      method: "POST",
    });
    if (status === 0 || !body) {
      const err = { code: "LOGIN_FAILED" as const, message: "Could not start Codex login." };
      dispatch({ type: "ERROR", error: err });
      throw new Error(err.message);
    }
    if ("ok" in body && body.ok === true && body.loggedIn) {
      closePopup(popup);
      // confirm account via status, then mark authenticated
      const account = await fetchAccount();
      dispatch({ type: "ALREADY_LOGGED_IN", account: account ?? undefined });
      return body;
    }
    if ("errorCode" in body && body.errorCode === "DEVICE_AUTH_NOT_ENABLED") {
      closePopup(popup);
      dispatch({ type: "DEVICE_AUTH_NOT_ENABLED" });
      return body;
    }
    if ("loginUrl" in body && "userCode" in body) {
      // point the already-open popup at the (validated) login URL
      try {
        pointPopupTo(popup, body.loginUrl, allowedHosts);
      } catch (e) {
        dispatch({
          type: "ERROR",
          error: { code: "LOGIN_FAILED", message: (e as Error).message, cause: e },
        });
        return body;
      }
      dispatch({ type: "LOGIN_PENDING", pending: body });
      startPolling();
      return body;
    }
    const msg = "error" in body ? body.error : "Could not start Codex login.";
    dispatch({ type: "ERROR", error: { code: "LOGIN_FAILED", message: msg } });
    return body;
  }

  async function probe(): Promise<StatusOutcome> {
    const { status, body } = await getJson<StatusResponse>(endpoints.status);
    return classifyStatus(status, body);
  }

  async function fetchAccount(): Promise<string | null> {
    const outcome = await probe();
    return outcome.kind === "authenticated" ? outcome.account : null;
  }

  function startPolling(): void {
    if (poller?.isRunning()) return; // idempotent
    poller = createPoller({
      probe,
      intervalMs: config.pollIntervalMs,
      maxConsecutiveFailures: config.maxPollFailures,
      getExpiresAt: () => state.expiresAt,
      onAuthenticated: (account) => {
        persistence.save(account);
        closePopup(popup);
        dispatch({ type: "AUTHENTICATED", account });
      },
      onLoggedOut: () => {
        persistence.clear();
        dispatch({ type: "LOGGED_OUT" });
      },
      onExpired: () => {
        closePopup(popup);
        dispatch({ type: "EXPIRED" });
      },
      onFailed: () =>
        dispatch({
          type: "ERROR",
          error: { code: "STATUS_FAILED", message: "Lost contact with the server while waiting for login." },
        }),
    });
    poller.start();

    // immediate re-poll when the tab returns to foreground
    if (typeof document !== "undefined" && !visibilityHandler) {
      visibilityHandler = () => {
        if (document.visibilityState === "visible") poller?.pokeNow();
      };
      document.addEventListener("visibilitychange", visibilityHandler);
    }
  }

  function cancelLogin(): void {
    poller?.stop();
    closePopup(popup);
    dispatch({ type: "CANCEL" });
  }

  async function logout(): Promise<void> {
    poller?.stop();
    closePopup(popup);
    // Clear local state FIRST so the UI never looks logged-in after the click,
    // even if the network request fails.
    persistence.clear();
    dispatch({ type: "LOGGED_OUT" });
    try {
      await fetchImpl(endpoints.logout, { method: "POST", credentials });
    } catch {
      /* backend session may linger; it should also TTL-expire. */
    }
  }

  async function resumeFromStorage(): Promise<boolean> {
    const persisted = persistence.load();
    if (!persisted) return false;
    dispatch({ type: "RESUME_START" });
    // verify with retries; sign out only on a definitive logged_out
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await probe();
      if (outcome.kind === "authenticated") {
        persistence.save(outcome.account);
        dispatch({ type: "AUTHENTICATED", account: outcome.account });
        return true;
      }
      if (outcome.kind === "logged_out") {
        persistence.clear();
        dispatch({ type: "LOGGED_OUT" });
        return false;
      }
      // transient / pending — wait and retry
      await delay(1000);
    }
    // couldn't confirm but never a definitive sign-out — fall back to idle
    dispatch({ type: "RESUME_STALE" });
    return false;
  }

  function destroy(): void {
    destroyed = true;
    poller?.stop();
    if (visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    closePopup(popup);
    popup = null;
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ensureSession,
    startLogin,
    pollStatus: probe,
    startPolling,
    cancelLogin,
    logout,
    resumeFromStorage,
    run: (prompt, handlers) => runClient.run(prompt, handlers),
    attachPopup: (p) => {
      popup = p;
      if (!p) dispatch({ type: "POPUP_BLOCKED" });
    },
    destroy,
    isDestroyed: () => destroyed,
    endpoints,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
