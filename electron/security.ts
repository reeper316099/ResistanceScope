// Session-level hardening: Content-Security-Policy, "no network" request blocking, permission denial.
import { type Session, type WebContents } from "electron";
import { APP_SCHEME } from "./appProtocol";

/** CSP for the packaged app: only our own files, no inline script/style, no network. */
export const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** CSP while developing: also lets the local Vite dev server inject styles and use its websocket. */
export function devCsp(devOrigin: string): string {
  const host = new URL(devOrigin).host;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ws://${host} ${APP_SCHEME}://app`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Requests that were refused because they left the app; the e2e tests read this list. */
export const blockedRequests: string[] = [];

/** Installs the request filter, CSP headers for the dev server, and denies every permission prompt. */
export function hardenSession(session: Session, devOrigin: string | null): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);

  // The app has no reason to touch the network. Only app://, data: and (in dev) the local dev server pass.
  session.webRequest.onBeforeRequest((details, callback) => {
    let allowed: boolean;
    try {
      const url = new URL(details.url);
      allowed =
        url.protocol === `${APP_SCHEME}:` ||
        url.protocol === "data:" ||
        url.protocol === "devtools:" ||
        (devOrigin !== null &&
          (url.origin === devOrigin ||
            (url.protocol === "ws:" && url.host === new URL(devOrigin).host)));
    } catch {
      allowed = false;
    }
    if (!allowed) blockedRequests.push(details.url);
    callback({ cancel: !allowed });
  });

  if (devOrigin !== null) {
    const csp = devCsp(devOrigin);
    session.webRequest.onHeadersReceived((details, callback) => {
      // app:// responses already carry their own CSP header; only the dev server's pages need one added.
      if (!details.url.startsWith(devOrigin)) {
        callback({});
        return;
      }
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
      });
    });
  }
}

/** Blocks navigation away from the app, new windows, and webviews for one web contents. */
export function lockDownContents(
  contents: WebContents,
  allowedOrigin: (url: URL) => boolean,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, rawUrl) => {
    let allowed: boolean;
    try {
      allowed = allowedOrigin(new URL(rawUrl));
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}
