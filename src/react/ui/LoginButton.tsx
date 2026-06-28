import type { UseCodexAuthResult } from "../useCodexAuth.js";
import { styles, OPENAI_LOGO } from "./styles.js";

const LABELS: Partial<Record<UseCodexAuthResult["status"], string>> = {
  connecting: "Connecting…",
  waitingForLogin: "Waiting for login…",
};

export function LoginButton({ auth }: { auth: UseCodexAuthResult }) {
  const busy = auth.isConnecting || auth.isWaiting;
  const label = LABELS[auth.status] ?? "Login with ChatGPT";
  return (
    <button
      type="button"
      onClick={auth.login}
      disabled={busy}
      style={{ ...styles.button, ...(busy ? styles.buttonDisabled : {}) }}
    >
      <img src={OPENAI_LOGO} alt="" width={18} height={18} />
      {label}
    </button>
  );
}
