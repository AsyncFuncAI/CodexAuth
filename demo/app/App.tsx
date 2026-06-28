import { useEffect, useState } from "react";
import { CodexAuth, OpenAIIcon, type UseCodexAuthResult } from "codex-auth";
import "./styles.css";

const PROMPT = "Write a haiku about the ocean.";
const CHATGPT_SECURITY = "https://chatgpt.com/#settings/Security";

export default function App() {
  return (
    <div className="ca-shell">
      <Hero />
      <div className="ca-panel">
        {/* Headless usage: the demo fully controls the layout via the render-prop. */}
        <CodexAuth enableGravatar pollIntervalMs={2500}>
          {(auth) => (auth.isAuthenticated ? <Console auth={auth} /> : <LoginView auth={auth} />)}
        </CodexAuth>
      </div>
    </div>
  );
}

function Hero() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText("npm install codex-auth").then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <header className="ca-hero">
      <div className="ca-spec">
        CodexAuth
        <br />
        React component
        <br />
        <b>v0.1.0 · MIT</b>
        <br />
        Login with ChatGPT
      </div>
      <h1 className="ca-title">
        <span className="br">&lt;</span>CodexAuth<span className="br"> /&gt;</span>
      </h1>
      <p className="ca-lead">
        A headless React component for "Login with ChatGPT". Your users sign in with their own
        ChatGPT account and run prompts on it.
      </p>
      <p className="ca-lead">
        <span className="hl">You never pay OpenAI for usage.</span> Tokens stay on your backend,
        never in the browser.
      </p>
      <div className="ca-install">
        <span className="dollar">$</span>
        npm install codex-auth
        <button type="button" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </header>
  );
}

function LoginView({ auth }: { auth: UseCodexAuthResult }) {
  const label = auth.isConnecting
    ? "Connecting…"
    : auth.isWaiting
      ? "Waiting for login…"
      : "Login with ChatGPT";
  return (
    <div className="ca-login-view">
      <button
        type="button"
        className="ca-btn ca-btn-primary"
        onClick={auth.login}
        disabled={auth.isConnecting || auth.isWaiting}
      >
        <OpenAIIcon size={18} />
        {label}
      </button>

      {auth.isWaiting && auth.userCode ? (
        <div className="ca-code-card">
          <div className="ca-code-label">Enter this code in the opened tab</div>
          <div className="ca-code" title="Copy code" onClick={() => void auth.copyUserCode()}>
            {auth.userCode}
          </div>
          <div className="ca-helper">
            First time? Enable <strong>device code authorization</strong> in ChatGPT{" "}
            <a href={CHATGPT_SECURITY} target="_blank" rel="noopener noreferrer">
              Settings → Security
            </a>
            .
          </div>
        </div>
      ) : null}

      {auth.popupBlocked && auth.loginUrl ? (
        <a href={auth.loginUrl} target="_blank" rel="noopener noreferrer" className="ca-link">
          Popup blocked. Open the login page
        </a>
      ) : null}

      {auth.error && auth.error.code === "DEVICE_AUTH_NOT_ENABLED" ? (
        <p className="ca-helper">{auth.error.message}</p>
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
    auth.run(PROMPT, {
      onText: (text, mode) => {
        acc = mode === "replace" ? text : acc + text;
        setOutput(acc);
      },
      onDone: ({ text }) => {
        if (text.trim()) setOutput(text);
        setBusy(false);
      },
      onError: (e) => {
        setOutput((o) => (o ? o + "\n\n" : "") + "! " + e);
        setBusy(false);
      },
    });
  };

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
    <div className="ca-console">
      <div className="ca-account">
        <span className="ca-avatar">
          {auth.avatarUrl ? (
            <img src={auth.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            initial
          )}
        </span>
        <span className="ca-account-email">{label}</span>
        <span className="ca-account-status">connected</span>
        <button type="button" className="ca-disconnect" onClick={auth.logout}>
          Disconnect
        </button>
      </div>

      <pre className="ca-snippet">
        <span className="kw">const</span> codex = <span className="kw">new</span>{" "}
        <span className="fn">Codex</span>();{"\n\n"}
        <span className="kw">const</span> res = <span className="kw">await</span> codex.responses.
        <span className="fn">create</span>(&#123;{"\n"}
        {"  "}model: <span className="str">"gpt-5.5"</span>,{"\n"}
        {"  "}input: <span className="str">"{PROMPT}"</span>,{"\n"}
        &#125;);
      </pre>

      <button type="button" className="ca-btn ca-btn-primary ca-send" onClick={send} disabled={busy}>
        {busy ? "Running…" : "Send request"}
      </button>
      <div className="ca-send-hint">Press ⌘↵ to send</div>

      <div className="ca-output-label">Output</div>
      <div className="ca-output">
        {output ? (
          <>
            {output}
            {busy ? <span className="ca-cursor" /> : null}
          </>
        ) : (
          <span className="placeholder">Run the snippet to stream the model's output here.</span>
        )}
      </div>
    </div>
  );
}
