import { useState } from "react";
import type { UseCodexAuthResult } from "../useCodexAuth.js";
import { styles } from "./styles.js";

const CHATGPT_SETTINGS = "https://chatgpt.com/#settings/Security";

export function DeviceCodeCard({ auth }: { auth: UseCodexAuthResult }) {
  const [copied, setCopied] = useState(false);
  if (!auth.userCode) return null;

  const onCopy = async () => {
    const ok = await auth.copyUserCode();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.status}>Enter this code in the opened browser tab</div>
      <div
        style={styles.code}
        title="Copy code"
        onClick={onCopy}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCopy()}
      >
        {auth.userCode}
        {copied ? " ✓" : ""}
      </div>
      <div style={styles.helper}>
        First time? Enable <strong>device code authorization</strong> for Codex in ChatGPT.{" "}
        <a
          href={CHATGPT_SETTINGS}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          Settings → Security &amp; Login
        </a>
        {auth.isWaiting ? (
          <>
            {" · "}
            <button type="button" onClick={auth.cancelLogin} style={styles.logout}>
              Start over
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
