import type { Request, Response, NextFunction } from "express";

/**
 * CSRF defense for the cookie-authenticated contract. The session cookie is sent
 * automatically by the browser, so a state-changing POST needs an extra check.
 * We enforce same-origin via Sec-Fetch-Site (modern browsers) with an Origin
 * fallback. This is in ADDITION to SameSite=Strict on the cookie.
 */
export function enforceSameOrigin(allowedOrigins?: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secFetchSite = req.headers["sec-fetch-site"];
    if (typeof secFetchSite === "string") {
      if (secFetchSite === "same-origin" || secFetchSite === "none") return next();
      // cross-site / same-site → only allow if the Origin is explicitly allowlisted
      const origin = req.headers.origin;
      if (origin && allowedOrigins?.includes(origin)) return next();
      res.status(403).json({ error: "cross-origin request rejected" });
      return;
    }
    // No Sec-Fetch-Site (older client): fall back to an Origin check.
    const origin = req.headers.origin;
    if (!origin) return next(); // same-origin navigations often omit Origin
    const host = req.headers.host;
    try {
      const o = new URL(origin);
      if (o.host === host) return next();
    } catch {
      /* fallthrough */
    }
    if (allowedOrigins?.includes(origin)) return next();
    res.status(403).json({ error: "cross-origin request rejected" });
  };
}

/**
 * CORS for cross-origin backends. Only listed origins get credentialed CORS, and
 * we echo the SPECIFIC origin (never `*`, never a reflected arbitrary origin) so
 * credentials can never be combined with a wildcard.
 */
export function corsForAllowedOrigins(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
