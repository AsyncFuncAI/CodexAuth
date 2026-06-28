import type { UseCodexAuthResult } from "../useCodexAuth.js";
import { styles } from "./styles.js";

/**
 * Shown when the popup was blocked. The loginUrl is only known AFTER startLogin
 * resolves, so we show a holding line until then, then reveal the anchor
 * (target=_blank anchors are virtually never blocked).
 */
export function PopupFallback({ auth }: { auth: UseCodexAuthResult }) {
  if (!auth.popupBlocked) return null;
  return (
    <div style={styles.status}>
      Your browser blocked the popup.{" "}
      {auth.loginUrl ? (
        <a href={auth.loginUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
          Open the login page
        </a>
      ) : (
        <span>Preparing the login link…</span>
      )}
    </div>
  );
}
