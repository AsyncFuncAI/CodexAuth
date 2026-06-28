// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CodexAuth } from "../src/react/CodexAuth.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function routeFetch(map: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const key = `${init?.method ?? "GET"} ${u}`;
    const h = map[key] ?? map[u];
    if (!h) throw new Error(`unexpected fetch ${key}`);
    return h();
  });
}

let openSpy: ReturnType<typeof vi.fn>;
let fakePopup: { location: { href: string }; closed: boolean; close: () => void; document: any };

beforeEach(() => {
  localStorage.clear();
  fakePopup = {
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(),
    document: { write: vi.fn(), close: vi.fn(), title: "" },
  };
  openSpy = vi.fn(() => fakePopup);
  vi.stubGlobal("open", openSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<CodexAuth> default UI", () => {
  it("renders the login button initially", () => {
    vi.stubGlobal("fetch", routeFetch({}));
    render(<CodexAuth />);
    expect(screen.getByText("Login with ChatGPT")).toBeTruthy();
  });

  it("opens a popup synchronously on click (before the network resolves)", async () => {
    let resolveSession: (r: Response) => void = () => {};
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/session")) {
        return new Promise<Response>((res) => (resolveSession = res));
      }
      return json(200, { ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CodexAuth />);
    fireEvent.click(screen.getByText("Login with ChatGPT"));
    // popup opened immediately, even though /session hasn't resolved
    expect(openSpy).toHaveBeenCalledWith("about:blank", "codex-login", expect.any(String));
    act(() => resolveSession(json(200, { ok: true })));
  });

  it("does not open two popups on a double click (single-flight)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "POST /api/codex/session": () => json(200, { ok: true }),
        "POST /api/codex/login/start": () =>
          json(200, {
            loginUrl: "https://auth.openai.com/x",
            userCode: "BNPY-MZ5DA",
            expiresAt: Date.now() + 60_000,
          }),
        "GET /api/codex/status": () => json(200, { ok: false }),
      }),
    );
    render(<CodexAuth />);
    const btn = screen.getByText("Login with ChatGPT");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the device code and points the popup at the login URL", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "POST /api/codex/session": () => json(200, { ok: true }),
        "POST /api/codex/login/start": () =>
          json(200, {
            loginUrl: "https://auth.openai.com/oauth/x",
            userCode: "BNPY-MZ5DA",
            expiresAt: Date.now() + 60_000,
          }),
        "GET /api/codex/status": () => json(200, { ok: false }),
      }),
    );
    render(<CodexAuth />);
    fireEvent.click(screen.getByText("Login with ChatGPT"));
    await waitFor(() => expect(screen.getByText("BNPY-MZ5DA")).toBeTruthy());
    expect(fakePopup.location.href).toBe("https://auth.openai.com/oauth/x");
  });

  it("reaches the authenticated console after status flips to ok", async () => {
    let authed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/session")) return json(200, { ok: true });
        if (url.endsWith("/login/start"))
          return json(200, {
            loginUrl: "https://auth.openai.com/x",
            userCode: "AAAA-BBBB",
            expiresAt: Date.now() + 60_000,
          });
        if (url.endsWith("/status"))
          return authed ? json(200, { ok: true, account: "me@x.com" }) : json(200, { ok: false });
        return json(200, {});
      }),
    );
    render(<CodexAuth pollIntervalMs={20} />);
    fireEvent.click(screen.getByText("Login with ChatGPT"));
    await waitFor(() => expect(screen.getByText("AAAA-BBBB")).toBeTruthy());
    authed = true;
    await waitFor(() => expect(screen.getByText("me@x.com")).toBeTruthy(), { timeout: 2000 });
  });

  it("renders the popup-blocked fallback when window.open returns null", async () => {
    openSpy.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "POST /api/codex/session": () => json(200, { ok: true }),
        "POST /api/codex/login/start": () =>
          json(200, {
            loginUrl: "https://auth.openai.com/x",
            userCode: "AAAA",
            expiresAt: Date.now() + 60_000,
          }),
        "GET /api/codex/status": () => json(200, { ok: false }),
      }),
    );
    render(<CodexAuth />);
    fireEvent.click(screen.getByText("Login with ChatGPT"));
    await waitFor(() => expect(screen.getByText(/blocked the popup/i)).toBeTruthy());
  });

  it("headless render-prop receives state and renders no default UI", () => {
    vi.stubGlobal("fetch", routeFetch({}));
    render(
      <CodexAuth>
        {(auth) => <div data-testid="custom">status:{auth.status}</div>}
      </CodexAuth>,
    );
    expect(screen.getByTestId("custom").textContent).toContain("status:idle");
    expect(screen.queryByText("Login with ChatGPT")).toBeNull();
  });
});
