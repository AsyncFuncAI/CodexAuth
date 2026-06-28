"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  createCodexClient,
  type CodexClient,
} from "../core/createCodexClient.js";
import type {
  CodexClientConfig,
  CodexAuthSnapshot,
} from "../core/contract.js";
import { openBlankPopup, writeHoldingScreen } from "../core/popup.js";
import { gravatarUrl } from "../core/gravatar.js";
import type { RunHandlers, RunController } from "../core/run.js";

export interface UseCodexAuthOptions extends CodexClientConfig {
  /** Provide a shared client instead of letting the hook create one. */
  client?: CodexClient;
  /** Opt in to Gravatar avatar lookup (leaks an email MD5 to gravatar.com). Default false. */
  enableGravatar?: boolean;
  onAuthenticated?: (info: { account: string }) => void;
  onError?: (error: NonNullable<CodexAuthSnapshot["error"]>) => void;
  onLogout?: () => void;
}

export interface UseCodexAuthResult {
  status: CodexAuthSnapshot["status"];
  account: string | null;
  userCode: string | null;
  loginUrl: string | null;
  expiresAt: number | null;
  error: CodexAuthSnapshot["error"];
  popupBlocked: boolean;
  isAuthenticated: boolean;
  isConnecting: boolean;
  isWaiting: boolean;
  avatarUrl: string | null;
  login: () => void;
  logout: () => Promise<void>;
  cancelLogin: () => void;
  run: (prompt: string, handlers?: RunHandlers) => RunController;
  copyUserCode: () => Promise<boolean>;
  openLoginPage: () => void;
}

/**
 * Bind the framework-agnostic core client to React. The client is created ONCE
 * (stabilized) — inline config object literals do not recreate it on every
 * render. `login()` opens the blank popup synchronously as its first statement
 * (popup-blocker survival) and is single-flight guarded against StrictMode
 * double-invoke.
 */
export function useCodexAuth(options: UseCodexAuthOptions = {}): UseCodexAuthResult {
  const { client: externalClient, enableGravatar = false } = options;

  // Stabilize the client: created once. We intentionally read config once — a
  // changing inline config literal must NOT orphan the popup/subscriptions.
  // If a prior StrictMode pass destroyed our owned client, recreate it.
  const clientRef = useRef<CodexClient | null>(null);
  if (!clientRef.current || (!externalClient && clientRef.current.isDestroyed())) {
    clientRef.current = externalClient ?? createCodexClient(options);
  }
  const client = clientRef.current;

  // Latest callbacks without re-subscribing.
  const cbRef = useRef(options);
  cbRef.current = options;

  const pendingDestroy = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = useSyncExternalStore(
    useCallback((cb) => client.subscribe(cb), [client]),
    () => client.getState(),
    () => client.getState(),
  );

  // Fire user callbacks on status edges.
  const prevStatus = useRef(snapshot.status);
  useEffect(() => {
    if (prevStatus.current !== snapshot.status) {
      if (snapshot.status === "authenticated" && snapshot.account) {
        cbRef.current.onAuthenticated?.({ account: snapshot.account });
      } else if (snapshot.status === "loggedOut") {
        cbRef.current.onLogout?.();
      } else if (snapshot.status === "error" && snapshot.error) {
        cbRef.current.onError?.(snapshot.error);
      }
      prevStatus.current = snapshot.status;
    }
  }, [snapshot.status, snapshot.account, snapshot.error]);

  // Resume a persisted session on mount; tear down on unmount.
  // Destroy is DEFERRED so React 18 StrictMode's mount→unmount→mount cycle (which
  // would otherwise permanently destroy our ref-persisted client) cancels it on
  // the immediate remount.
  useEffect(() => {
    void client.resumeFromStorage();
    return () => {
      if (externalClient) return; // never destroy a client we don't own
      const t = setTimeout(() => client.destroy(), 0);
      // store the pending-destroy timer so a quick remount can cancel it
      pendingDestroy.current = t;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Cancel a deferred destroy if we remounted right away (StrictMode).
  useEffect(() => {
    if (pendingDestroy.current) {
      clearTimeout(pendingDestroy.current);
      pendingDestroy.current = null;
    }
  });

  const loginInFlight = useRef(false);

  const login = useCallback(() => {
    // Single-flight: ignore if a login is already in progress (StrictMode / double click).
    const s = client.getState().status;
    if (loginInFlight.current || s === "connecting" || s === "waitingForLogin") return;
    loginInFlight.current = true;

    // FIRST STATEMENT, synchronous, before any await: open the blank popup so the
    // browser's popup blocker permits it. The login URL isn't known yet.
    const popup = openBlankPopup();
    writeHoldingScreen(popup);
    client.attachPopup(popup);
    // If popup is null the browser blocked it; startLogin still resolves the
    // loginUrl and the default UI renders the PopupFallback affordance.

    void (async () => {
      try {
        await client.ensureSession();
        await client.startLogin();
      } catch {
        /* state machine already carries the error */
      } finally {
        loginInFlight.current = false;
      }
    })();
  }, [client]);

  const logout = useCallback(() => client.logout(), [client]);
  const cancelLogin = useCallback(() => client.cancelLogin(), [client]);
  const run = useCallback(
    (prompt: string, handlers?: RunHandlers) => client.run(prompt, handlers),
    [client],
  );

  const copyUserCode = useCallback(async () => {
    const code = client.getState().userCode;
    if (!code) return false;
    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch {
      return false; // clipboard unavailable (insecure context / older browser)
    }
  }, [client]);

  const openLoginPage = useCallback(() => {
    const url = client.getState().loginUrl;
    if (url) window.open(url, "codex-login", "noopener,noreferrer");
  }, [client]);

  const avatarUrl = useMemo(() => {
    if (!enableGravatar || !snapshot.account) return null;
    // SubtleCrypto not needed (we use a pure-JS MD5), but keep avatar opt-in.
    return gravatarUrl(snapshot.account);
  }, [enableGravatar, snapshot.account]);

  return {
    status: snapshot.status,
    account: snapshot.account,
    userCode: snapshot.userCode,
    loginUrl: snapshot.loginUrl,
    expiresAt: snapshot.expiresAt,
    error: snapshot.error,
    popupBlocked: snapshot.popupBlocked,
    isAuthenticated: snapshot.status === "authenticated",
    isConnecting: snapshot.status === "connecting",
    isWaiting: snapshot.status === "waitingForLogin",
    avatarUrl,
    login,
    logout,
    cancelLogin,
    run,
    copyUserCode,
    openLoginPage,
  };
}
