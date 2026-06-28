import type {
  CodexAuthSnapshot,
  CodexAuthError,
  LoginStartPending,
} from "./contract.js";

/**
 * Pure, I/O-free auth state machine. All effects (fetch, timers, popup) are
 * performed by createCodexClient, which feeds the outcomes back in as events.
 *
 * States: idle · resuming · connecting · waitingForLogin · authenticated · error · loggedOut
 * `idle` (never authenticated) and `loggedOut` (explicitly signed out) are kept
 * distinct for consumers, though the default button renders them identically.
 */

export type CodexAuthEvent =
  | { type: "RESUME_START" }
  | { type: "RESUME_STALE" }
  | { type: "LOGIN_CLICK" }
  | { type: "POPUP_BLOCKED" }
  | { type: "LOGIN_PENDING"; pending: LoginStartPending }
  | { type: "ALREADY_LOGGED_IN"; account?: string }
  | { type: "DEVICE_AUTH_NOT_ENABLED" }
  | { type: "AUTHENTICATED"; account: string }
  | { type: "EXPIRED" }
  | { type: "LOGGED_OUT" }
  | { type: "CANCEL" }
  | { type: "ERROR"; error: CodexAuthError }
  | { type: "RESET" };

export const initialSnapshot: CodexAuthSnapshot = {
  status: "idle",
  account: null,
  userCode: null,
  loginUrl: null,
  expiresAt: null,
  popupBlocked: false,
  error: null,
};

function err(
  code: CodexAuthError["code"],
  message: string,
  cause?: unknown,
): CodexAuthError {
  return { code, message, cause };
}

/** Reduce (state, event) → next state. Referentially transparent. */
export function transition(
  state: CodexAuthSnapshot,
  event: CodexAuthEvent,
): CodexAuthSnapshot {
  switch (event.type) {
    case "RESUME_START":
      return { ...state, status: "resuming", error: null };

    case "RESUME_STALE":
      // Couldn't confirm a definitive sign-out — fall back to a fresh idle.
      return { ...initialSnapshot };

    case "LOGIN_CLICK":
      return {
        ...state,
        status: "connecting",
        error: null,
        popupBlocked: false,
        userCode: null,
        loginUrl: null,
        expiresAt: null,
      };

    case "POPUP_BLOCKED":
      return {
        ...state,
        popupBlocked: true,
        // stay in connecting until startLogin resolves the loginUrl; the error
        // is informational so the default UI can render the fallback affordance
        error: err("POPUP_BLOCKED", "The login popup was blocked by the browser."),
      };

    case "LOGIN_PENDING":
      return {
        ...state,
        status: "waitingForLogin",
        userCode: event.pending.userCode,
        loginUrl: event.pending.loginUrl,
        expiresAt: event.pending.expiresAt,
        error: state.popupBlocked ? state.error : null,
      };

    case "ALREADY_LOGGED_IN":
      return {
        ...initialSnapshot,
        status: "authenticated",
        account: event.account ?? null,
      };

    case "DEVICE_AUTH_NOT_ENABLED":
      return {
        ...state,
        status: "error",
        error: err(
          "DEVICE_AUTH_NOT_ENABLED",
          "Enable device code authorization in ChatGPT Settings → Security & Login, then retry.",
        ),
      };

    case "AUTHENTICATED":
      return {
        ...initialSnapshot,
        status: "authenticated",
        account: event.account,
      };

    case "EXPIRED":
      return {
        ...state,
        status: "error",
        userCode: null,
        loginUrl: null,
        error: err("EXPIRED", "The device code expired. Start the login again."),
      };

    case "LOGGED_OUT":
    case "CANCEL":
      return { ...initialSnapshot, status: "loggedOut" };

    case "ERROR":
      return { ...state, status: "error", error: event.error };

    case "RESET":
      return { ...initialSnapshot };

    default: {
      // Exhaustiveness guard: unknown events leave state unchanged.
      return state;
    }
  }
}
