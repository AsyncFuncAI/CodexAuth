/**
 * Popup helpers implementing the "secret sauce": open a BLANK popup synchronously
 * inside the click handler (before any await) so the browser's popup blocker
 * permits it, then redirect it to the real login URL once the backend returns one.
 *
 * Verified against login-with-chatgpt.vercel.app's app.js.
 */

const DEFAULT_ALLOWED_HOSTS = ["auth.openai.com"];

const POPUP_FEATURES = "popup,width=520,height=720";

/** Open a blank popup synchronously. Returns null if the browser blocked it. */
export function openBlankPopup(): Window | null {
  if (typeof window === "undefined") return null;
  try {
    const w = 520;
    const h = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    return window.open(
      "about:blank",
      "codex-login",
      `${POPUP_FEATURES},left=${Math.round(left)},top=${Math.round(top)}`,
    );
  } catch {
    return null;
  }
}

/**
 * Write a static "Connecting…" holding screen into the popup while we await the
 * login URL. The HTML is a trusted constant — never interpolate server data here
 * (it would be an XSS sink in the popup document).
 */
export function writeHoldingScreen(popup: Window | null): void {
  if (!popup) return;
  try {
    popup.document.title = "Connecting…";
    popup.document.write(HOLDING_HTML);
    popup.document.close();
  } catch {
    /* popup closed or already navigated cross-origin */
  }
}

/**
 * Validate a login URL before navigating the popup to it. Rejects non-https
 * schemes (e.g. javascript:, http:) and hosts outside the allowlist, so a
 * compromised/misconfigured backend response cannot redirect the popup anywhere.
 */
export function assertSafeLoginUrl(
  url: string,
  allowedHosts: string[] = DEFAULT_ALLOWED_HOSTS,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid login URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing non-https login URL: ${parsed.protocol}`);
  }
  if (!allowedHosts.includes(parsed.host)) {
    throw new Error(`Login URL host not allowed: ${parsed.host}`);
  }
  return parsed;
}

/** Point an already-open popup at the validated login URL. Returns false if blocked/closed. */
export function pointPopupTo(
  popup: Window | null,
  url: string,
  allowedHosts?: string[],
): boolean {
  assertSafeLoginUrl(url, allowedHosts);
  if (!popup || popup.closed) return false;
  try {
    popup.location.href = url;
    return true;
  } catch {
    return false;
  }
}

/** Null-guarded close. */
export function closePopup(popup: Window | null): void {
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    /* ignore */
  }
}

/**
 * Whether the user manually closed the popup. Guarded against the brief window
 * during the about:blank → cross-origin navigation where `.closed` can throw or
 * read inconsistently.
 */
export function isClosed(popup: Window | null): boolean {
  if (!popup) return false;
  try {
    return popup.closed;
  } catch {
    return false;
  }
}

const HOLDING_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting…</title>
<style>
  :root { color-scheme: dark; }
  html,body { height:100%; margin:0; }
  body { display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:24px; background:#0A0A0A; color:#fff;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .spinner { width:26px; height:26px; border-radius:50%;
    border:2px solid rgba(255,255,255,.15); border-top-color:rgba(255,255,255,.9);
    animation:spin .7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .phrase { font-size:14px; color:rgba(255,255,255,.7); }
</style></head>
<body><div class="spinner"></div><div class="phrase">Connecting to ChatGPT…</div></body></html>`;
