/**
 * Pure-HTTP OpenAI Codex OAuth (no `codex` CLI binary, no Next.js).
 *
 * Reuses OpenAI's official Codex CLI OAuth client (the same first-party
 * credential the CLI uses) via the device-code flow:
 *   1. POST /api/accounts/deviceauth/usercode  -> { device_auth_id, user_code, interval }
 *   2. POST /api/accounts/deviceauth/token      -> { authorization_code, code_verifier } once approved
 *   3. POST /oauth/token (authorization_code)    -> { access_token, refresh_token, expires_in }
 *
 * The account id is read from the access token's JWT claim. Because this is all
 * `fetch`, the directRunner built on top works on serverless (Vercel) too.
 *
 * Approach and constants verified against the Codex CLI and the
 * Xyntera/chatgpt-login-app + EvanZhouDev/openai-oauth references.
 */

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const DEVICE_USERCODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
export const DEVICE_VERIFICATION_URL = `${AUTH_BASE}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;

const JWT_CLAIM = "https://api.openai.com/auth";

export interface OAuthTokens {
  access: string;
  refresh: string;
  /** Absolute epoch-ms expiry of the access token. */
  expires: number;
}
export interface OAuthCredentials extends OAuthTokens {
  accountId: string;
  /** email / name decoded from the id-or-access token, when present. */
  account?: string;
}

const fetchImpl = (f?: typeof fetch) => f ?? globalThis.fetch.bind(globalThis);

/** Base64url-decode to a UTF-8 string, working on both Node and pure edge runtimes. */
function b64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    // edge / browser path
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  // Node path
  return Buffer.from(b64, "base64").toString("utf8");
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountIdFrom(accessToken: string): string | null {
  const claim = decodeJwt(accessToken)?.[JWT_CLAIM] as { chatgpt_account_id?: string } | undefined;
  const id = claim?.chatgpt_account_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function accountLabelFrom(token: string): string | undefined {
  const c = decodeJwt(token) as { email?: string; name?: string } | null;
  return c?.email ?? c?.name ?? undefined;
}

async function readTokens(res: Response, op: string): Promise<OAuthTokens> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token ${op} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  } | null;
  if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`token ${op} response missing fields`);
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

function credentials(tokens: OAuthTokens, idToken?: string): OAuthCredentials {
  const accountId = accountIdFrom(tokens.access);
  if (!accountId) throw new Error("could not extract chatgpt_account_id from access token");
  return {
    ...tokens,
    accountId,
    account: accountLabelFrom(idToken ?? tokens.access),
  };
}

// ---- device-code flow ----

export interface DeviceAuthStart {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
}

/** Step 1: get a user code to display. */
export async function startDeviceAuth(fetchOverride?: typeof fetch): Promise<DeviceAuthStart> {
  const f = fetchImpl(fetchOverride);
  const res = await f(DEVICE_USERCODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`device code request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as {
    device_auth_id?: string;
    user_code?: string;
    interval?: number | string;
  } | null;
  const interval = typeof json?.interval === "string" ? Number(json.interval) : json?.interval;
  if (!json?.device_auth_id || !json.user_code || typeof interval !== "number") {
    throw new Error("invalid device code response");
  }
  return { deviceAuthId: json.device_auth_id, userCode: json.user_code, intervalSeconds: interval };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "complete"; credentials: OAuthCredentials }
  | { status: "failed"; message: string };

/** Step 2: poll once. Returns complete (with credentials) when the user approves. */
export async function pollDeviceAuth(
  deviceAuthId: string,
  userCode: string,
  fetchOverride?: typeof fetch,
): Promise<DevicePollResult> {
  const f = fetchImpl(fetchOverride);
  const res = await f(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });

  if (res.ok) {
    const json = (await res.json()) as { authorization_code?: string; code_verifier?: string } | null;
    if (!json?.authorization_code || !json.code_verifier) {
      return { status: "failed", message: "invalid device token response" };
    }
    const tokens = await exchangeDeviceCode(json.authorization_code, json.code_verifier, f);
    return { status: "complete", credentials: credentials(tokens) };
  }

  if (res.status === 403 || res.status === 404) return { status: "pending" };

  const body = await res.text().catch(() => "");
  let code: unknown;
  try {
    const j = JSON.parse(body) as { error?: string | { code?: string } } | null;
    const e = j?.error;
    code = typeof e === "object" ? e?.code : e;
  } catch {
    /* non-json */
  }
  if (code === "deviceauth_authorization_pending") return { status: "pending" };
  if (code === "slow_down") return { status: "slow_down" };
  return { status: "failed", message: `device auth failed (${res.status})` };
}

async function exchangeDeviceCode(code: string, verifier: string, f: typeof fetch): Promise<OAuthTokens> {
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }),
  });
  return readTokens(res, "exchange");
}

/** Refresh an access token (and rotate the refresh token). */
export async function refreshAccessToken(
  refreshToken: string,
  fetchOverride?: typeof fetch,
): Promise<OAuthCredentials> {
  const f = fetchImpl(fetchOverride);
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  return credentials(await readTokens(res, "refresh"));
}

export { accountIdFrom, accountLabelFrom, decodeJwt };
