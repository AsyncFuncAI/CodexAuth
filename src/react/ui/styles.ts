import type { CSSProperties } from "react";

/**
 * Minimal inline styles so the default UI looks complete out of the box without
 * shipping a separate stylesheet. Consumers who want full control use the
 * headless render-prop API instead and these never load.
 */
export const styles = {
  root: {
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  } as CSSProperties,
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 22px",
    borderRadius: 12,
    border: "none",
    background: "#fff",
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,
  buttonDisabled: { opacity: 0.7, cursor: "default" } as CSSProperties,
  status: { fontSize: 13, color: "rgba(255,255,255,.7)", textAlign: "center" } as CSSProperties,
  card: {
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 14,
    padding: 20,
    textAlign: "center",
    maxWidth: 320,
  } as CSSProperties,
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 22,
    letterSpacing: "0.08em",
    fontWeight: 700,
    cursor: "pointer",
    userSelect: "all",
  } as CSSProperties,
  helper: { fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 12 } as CSSProperties,
  avatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "#2a2a2a",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    overflow: "hidden",
  } as CSSProperties,
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" } as CSSProperties,
  link: { color: "#7dd3fc", textDecoration: "underline" } as CSSProperties,
  logout: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,.15)",
    color: "rgba(255,255,255,.8)",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
  } as CSSProperties,
};

export const OPENAI_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#0a0a0a"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07Z"/></svg>`,
  );
