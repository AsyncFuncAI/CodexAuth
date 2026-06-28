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
