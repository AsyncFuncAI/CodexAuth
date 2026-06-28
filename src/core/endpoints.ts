import type { CodexClientConfig, EndpointMap } from "./contract.js";

export const DEFAULT_BASE_PATH = "/api/codex";

/**
 * Merge a basePath with per-route overrides.
 *
 * Precedence: an explicit `endpoints[route]` value REPLACES the derived path
 * verbatim (absolute URL or relative path) — this is what enables cross-origin
 * backends. Any route not overridden is derived from `basePath`.
 */
export function resolveEndpoints(config: CodexClientConfig = {}): EndpointMap {
  const base = (config.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, "");
  const o = config.endpoints ?? {};
  return {
    session: o.session ?? `${base}/session`,
    loginStart: o.loginStart ?? `${base}/login/start`,
    status: o.status ?? `${base}/status`,
    runStream: o.runStream ?? `${base}/run/stream`,
    logout: o.logout ?? `${base}/logout`,
  };
}
