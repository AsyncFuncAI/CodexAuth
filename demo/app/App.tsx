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
      <h1 style={S.h1}>&lt;CodexAuth /&gt;</h1>
      <p style={S.lead}>
        A drop-in Login with ChatGPT button for React. Your users sign in with
        their own ChatGPT account and run prompts on it.
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
        <ChatGPTLogo />
        {auth.isConnecting ? "Connecting…" : auth.isWaiting ? "Waiting for login…" : "Login with ChatGPT"}
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
        {"  "}model: <span style={S.str}>"gpt-5.5"</span>,{"\n"}
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

// Official OpenAI mark (lobehub/lobe-icons, MIT). currentColor inherits button text.
function ChatGPTLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
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
    display: "inline-flex", alignItems: "center", gap: 10,
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
