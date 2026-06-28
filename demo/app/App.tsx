import { useEffect, useState } from "react";
import { CodexAuth, type UseCodexAuthResult } from "codex-auth";

const SNIPPET_PROMPT = "Write a haiku about the ocean.";

export default function App() {
  return (
    <div style={S.shell}>
      <Hero />
      <div style={S.panel}>
        {/* Headless usage: we fully control the layout via the render-prop. */}
        <CodexAuth enableGravatar pollIntervalMs={2500}>
          {(auth) =>
            auth.isAuthenticated ? <Console auth={auth} /> : <LoginView auth={auth} />
          }
        </CodexAuth>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div style={S.hero}>
      <h1 style={S.h1}>&lt;LoginWithChatGPT /&gt;</h1>
      <p style={S.lead}>
        Add a Login with ChatGPT button to your site. Let users log in with their
        personal ChatGPT account and run prompts on it.
      </p>
      <p style={S.lead}>
        You never pay OpenAI for usage. Works with users on any plan: Free, Plus, or Pro.
      </p>
    </div>
  );
}

function LoginView({ auth }: { auth: UseCodexAuthResult }) {
  return (
    <div style={S.center}>
      <button
        type="button"
        onClick={auth.login}
        disabled={auth.isConnecting || auth.isWaiting}
        style={S.loginBtn}
      >
        ◍ {auth.isConnecting ? "Connecting…" : auth.isWaiting ? "Waiting for login…" : "Login with ChatGPT"}
      </button>
      {auth.isWaiting && auth.userCode ? (
        <div style={S.code}>
          Enter code: <strong>{auth.userCode}</strong>
        </div>
      ) : null}
      {auth.popupBlocked && auth.loginUrl ? (
        <a href={auth.loginUrl} target="_blank" rel="noopener noreferrer" style={S.link}>
          Popup blocked — open the login page
        </a>
      ) : null}
      {auth.error && auth.error.code === "DEVICE_AUTH_NOT_ENABLED" ? (
        <p style={S.helper}>{auth.error.message}</p>
      ) : null}
    </div>
  );
}

function Console({ auth }: { auth: UseCodexAuthResult }) {
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const label = (auth.account || "ChatGPT account").trim();
  const initial = (label[0] || "U").toUpperCase();

  const send = () => {
    if (busy) return;
    setBusy(true);
    setOutput("");
    let acc = "";
    auth.run(SNIPPET_PROMPT, {
      onText: (text, mode) => {
        acc = mode === "replace" ? text : acc + text;
        setOutput(acc);
      },
      onDone: ({ text }) => {
        if (text.trim()) setOutput(text);
        setBusy(false);
      },
      onError: (e) => {
        setOutput((o) => (o ? o + "\n\n" : "") + "⚠ " + e);
        setBusy(false);
      },
    });
  };

  // ⌘↵ / Ctrl+↵ sends the request, matching the hint shown under the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return (
    <div style={S.console}>
      {/* header */}
      <div style={S.row}>
        <span style={S.avatar}>
          {auth.avatarUrl ? (
            <img src={auth.avatarUrl} alt="" referrerPolicy="no-referrer" style={S.avatarImg} />
          ) : (
            initial
          )}
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        <button type="button" onClick={auth.logout} style={S.disconnect}>
          ⤴ Disconnect
        </button>
      </div>

      {/* code snippet card */}
      <pre style={S.snippet}>
        <span style={S.dim}>const</span> codex = <span style={S.dim}>new</span> Codex();{"\n\n"}
        <span style={S.dim}>const</span> res = <span style={S.dim}>await</span> codex.responses.create(&#123;{"\n"}
        {"  "}model: <span style={S.str}>"gpt-5.5-codex-fast"</span>,{"\n"}
        {"  "}input: <span style={S.str}>"{SNIPPET_PROMPT}"</span>,{"\n"}
        &#125;);
      </pre>

      <button type="button" onClick={send} disabled={busy} style={S.send}>
        {busy ? "Streaming…" : "Send request →"}
      </button>
      <div style={S.hint}>Press ⌘↵ to send</div>

      <div style={S.outputLabel}>Output</div>
      <div style={S.output}>
        {output ? output : <span style={S.dim}>Run the snippet to stream the model's output here.</span>}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "#fff",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
    padding: 24,
    boxSizing: "border-box",
  },
  hero: { alignSelf: "center", paddingLeft: 48, maxWidth: 560 },
  h1: { fontSize: 56, fontWeight: 700, margin: "0 0 24px" },
  lead: { color: "rgba(255,255,255,.55)", fontSize: 18, lineHeight: 1.5 },
  panel: {
    background: "#111",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 24,
    padding: 28,
    display: "flex",
    flexDirection: "column",
  },
  center: { margin: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 },
  loginBtn: {
    background: "#fff", color: "#0a0a0a", border: "none", borderRadius: 12,
    padding: "14px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer",
  },
  console: { display: "flex", flexDirection: "column", gap: 16 },
  row: { display: "flex", alignItems: "center", gap: 12, fontSize: 15 },
  avatar: {
    width: 36, height: 36, borderRadius: "50%", background: "#fff", color: "#0a0a0a",
    display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  disconnect: { background: "transparent", border: "none", color: "rgba(255,255,255,.7)", cursor: "pointer", fontSize: 14 },
  snippet: {
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)",
    borderRadius: 14, padding: 20, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,.85)", margin: 0, whiteSpace: "pre-wrap",
  },
  dim: { color: "rgba(255,255,255,.4)" },
  str: { color: "#fff", background: "rgba(255,255,255,.08)", borderRadius: 4, padding: "0 2px" },
  send: {
    background: "#fff", color: "#0a0a0a", border: "none", borderRadius: 14,
    padding: "16px", fontSize: 15, fontWeight: 600, cursor: "pointer",
  },
  hint: { textAlign: "center", color: "rgba(255,255,255,.4)", fontSize: 13 },
  outputLabel: { color: "rgba(255,255,255,.5)", fontSize: 13, marginTop: 8 },
  output: { color: "rgba(255,255,255,.6)", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", minHeight: 48 },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 14, color: "rgba(255,255,255,.8)" },
  helper: { fontSize: 12, color: "rgba(255,255,255,.5)", textAlign: "center", maxWidth: 280 },
  link: { color: "#7dd3fc", textDecoration: "underline", fontSize: 13 },
};
