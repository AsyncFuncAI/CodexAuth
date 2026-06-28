import { useState } from "react";
import type { UseCodexAuthResult } from "../useCodexAuth.js";
import { styles } from "./styles.js";

export function AccountConsole({ auth }: { auth: UseCodexAuthResult }) {
  const [imgOk, setImgOk] = useState(true);
  const label = (auth.account || "ChatGPT account").trim();
  const initial = /[a-z0-9]/i.test(label[0] ?? "") ? label[0]!.toUpperCase() : "U";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={styles.avatar}>
        {auth.avatarUrl && imgOk ? (
          <img
            src={auth.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={styles.avatarImg}
            onError={() => setImgOk(false)}
          />
        ) : (
          initial
        )}
      </span>
      {/* account text is rendered as plain text — never dangerouslySetInnerHTML */}
      <span title={label}>{label}</span>
      <button type="button" onClick={auth.logout} style={styles.logout}>
        Disconnect
      </button>
    </div>
  );
}
