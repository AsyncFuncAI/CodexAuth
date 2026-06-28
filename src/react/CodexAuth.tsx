"use client";

import type { ReactNode } from "react";
import { useCodexAuth, type UseCodexAuthOptions, type UseCodexAuthResult } from "./useCodexAuth.js";
import { LoginButton } from "./ui/LoginButton.js";
import { DeviceCodeCard } from "./ui/DeviceCodeCard.js";
import { PopupFallback } from "./ui/PopupFallback.js";
import { AccountConsole } from "./ui/AccountConsole.js";
import { styles } from "./ui/styles.js";

export interface CodexAuthProps extends UseCodexAuthOptions {
  /**
   * Render-prop. When `children` is a function it receives the full hook result
   * and NO default UI is rendered (fully headless). Omit it to render the
   * default styled UI.
   */
  children?: (auth: UseCodexAuthResult) => ReactNode;
  className?: string;
}

/**
 * Drop-in "Login with ChatGPT" component.
 *
 *   // default UI
 *   <CodexAuth onAuthenticated={({account}) => ...} />
 *
 *   // headless — full control
 *   <CodexAuth>{(auth) => auth.isAuthenticated ? <Me/> : <button onClick={auth.login}>Sign in</button>}</CodexAuth>
 */
export function CodexAuth({ children, className, ...options }: CodexAuthProps) {
  const auth = useCodexAuth(options);

  if (typeof children === "function") {
    return <>{children(auth)}</>;
  }

  return (
    <div className={className} style={styles.root}>
      {auth.isAuthenticated ? (
        <AccountConsole auth={auth} />
      ) : (
        <>
          <LoginButton auth={auth} />
          {auth.isWaiting ? <DeviceCodeCard auth={auth} /> : null}
          <PopupFallback auth={auth} />
          {auth.error && auth.error.code === "DEVICE_AUTH_NOT_ENABLED" ? (
            <div style={styles.status}>{auth.error.message}</div>
          ) : null}
          {auth.error &&
          auth.error.code !== "DEVICE_AUTH_NOT_ENABLED" &&
          auth.error.code !== "POPUP_BLOCKED" ? (
            <div style={styles.status}>{auth.error.message}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
