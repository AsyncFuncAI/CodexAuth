import { Router, json as jsonBody, type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { handleCodexRequest, type CodexHandlerOptions, type CookieAttributes } from "../core/handler.js";

export interface CodexRouterOptions extends Omit<CodexHandlerOptions, "basePath"> {
  /** Mount path. Defaults to "/api/codex". Match it to where you app.use() the router. */
  basePath?: string;
}

export type { CookieAttributes };

/**
 * Express adapter. Thin wrapper that bridges Express req/res to the
 * framework-neutral `handleCodexRequest` core (which owns all the contract logic
 * and security hardening). Mount it:
 *
 *   app.use("/api/codex", createCodexRouter({ runner, cookieSecret }));
 */
export function createCodexRouter(opts: CodexRouterOptions): Router {
  if (!opts.cookieSecret || opts.cookieSecret.length < 16) {
    throw new Error(
      "createCodexRouter: cookieSecret must be a high-entropy string (>=16 chars), sourced from env.",
    );
  }
  const basePath = opts.basePath ?? "/api/codex";
  const handlerOpts: CodexHandlerOptions = { ...opts, basePath };
  const router = Router();
  router.use(jsonBody());

  // Catch-all under the mount path (router.use matches all methods/paths;
  // Express 5 dropped the bare "*" string route). Rebuild a Web Request from
  // the Express req and delegate to the framework-neutral core handler.
  router.use(async (req: ExpressRequest, res: ExpressResponse) => {
    const webReq = toWebRequest(req, basePath);
    const webRes = await handleCodexRequest(webReq, handlerOpts);
    await sendWebResponse(res, webRes);
  });

  return router;
}

function toWebRequest(req: ExpressRequest, basePath: string): Request {
  // Express strips the mount path from req.url; restore the full path so the
  // core handler can route on basePath.
  const fullPath = basePath.replace(/\/+$/, "") + (req.url === "/" ? "" : req.url);
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const host = req.headers.host ?? "localhost";
  const url = `${proto}://${host}${fullPath}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else if (v != null) headers.set(k, v);
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  // express.json() may have parsed the body already; re-serialize it for the
  // core handler's req.json(). If nothing parsed it, fall back to empty.
  let body: string | undefined;
  if (hasBody) {
    body =
      req.body && typeof req.body === "object" && Object.keys(req.body).length
        ? JSON.stringify(req.body)
        : typeof req.body === "string"
          ? req.body
          : undefined;
    if (body && !headers.has("content-type")) headers.set("content-type", "application/json");
  }

  return new Request(url, { method, headers, body });
}

async function sendWebResponse(res: ExpressResponse, webRes: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") res.append("Set-Cookie", value);
    else res.setHeader(key, value);
  });

  if (!webRes.body) {
    res.end();
    return;
  }
  // Stream the Web ReadableStream to the Express response (NDJSON for /run/stream).
  const reader = webRes.body.getReader();
  res.on("close", () => reader.cancel().catch(() => {}));
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
