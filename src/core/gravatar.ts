import { md5 } from "./md5.js";

/**
 * Build a Gravatar URL for an email. Uses MD5 (Gravatar's actual requirement —
 * NOT SHA-256). `d=404` means "no custom avatar" so the caller can fall back to
 * an initial-letter avatar instead of a generic silhouette.
 *
 * Privacy note: this leaks an MD5 of the email to gravatar.com. The feature is
 * OPT-IN at the component level (`enableGravatar` defaults to false).
 */
export function gravatarUrl(email: string, size = 64): string | null {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  const hash = md5(normalized);
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}
