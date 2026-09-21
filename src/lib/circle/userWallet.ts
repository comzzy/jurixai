/**
 * Circle User-Controlled Wallets — BROWSER flow (email OTP + PIN) on Arc.
 *
 * Uses @circle-fin/w3s-pw-web-sdk (dynamically imported so it stays out of the
 * SSR bundle). IMPORTANT: a single SDK instance is reused across the OTP login
 * and the PIN-setup challenge. Creating a second instance for the challenge (as
 * the old code did) leaves Circle's PIN screen unrendered, so the flow hangs on
 * "creating" forever. This mirrors Circle's own reference apps (e.g. Polaris).
 *
 * Chrome/Edge/Brave on a computer block Circle's hidden third-party iframe
 * (`pw-auth.circle.com`) even when the user "allows third-party cookies" — the
 * exception list is for the *site you are on* (jurixai.xyz), and getDeviceId
 * also races with warmup. Desktop therefore opens Circle as a first-party
 * popup; phones keep the iframe, which already works there.
 */
import { emailLoginStart, provisionWallet, listUserWallets } from "./userWallet.server";
import type { CircleWallet } from "./wallet";
import { toast } from "sonner";
import { CHAIN_DISPLAY_NAME, CIRCLE_CHAIN_CODE } from "@/lib/chain";
import { circleAppId } from "./appId";

const APP_ID = circleAppId();
const CHAIN = CIRCLE_CHAIN_CODE;
const CIRCLE_AUTH = "https://pw-auth.circle.com";
const DEVICE_ID_STORAGE_KEY = "jurixai_circle_device_id";
const SDK_VERSION = "1.1.11";

export function isEmailLoginConfigured(): boolean {
  return Boolean(APP_ID);
}

export function userWalletChain(): string {
  return CHAIN_DISPLAY_NAME;
}

export interface Session {
  userToken: string;
  encryptionKey: string;
}

type CircleLoginError = {
  message?: string;
  code?: number;
};

type CircleLoginResult = {
  userToken?: string;
  encryptionKey?: string;
  data?: {
    userToken?: string;
    encryptionKey?: string;
  };
};

// The SDK's types are loose; keep a local alias to avoid `any` sprawl.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W3S = any;

type LoginConfigs = {
  deviceToken: string;
  deviceEncryptionKey: string;
  otpToken: string;
};

/**
 * Circle's SDK deps (jsonwebtoken/uuid) expect Node globals in the browser. The
 * client build aliases the `buffer`/`process` modules, but some transitive code
 * reads the bare `Buffer`/`process`/`global` globals — populate them before the
 * SDK loads. No-op on the server.
 */
async function ensureBrowserGlobals(): Promise<void> {
  if (typeof window === "undefined") return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.global) g.global = globalThis;
  if (!g.Buffer) {
    const { Buffer } = await import("buffer");
    g.Buffer = Buffer;
  }
  if (!g.process) {
    // @ts-expect-error Vite aliases this to the browser process polyfill.
    const proc = (await import("process/browser")) as { default?: unknown };
    g.process = proc.default ?? proc;
  }
  const p = g.process as Record<string, unknown> | undefined;
  if (p && !p.env) {
    p.env = {};
  }
  patchCircleIframeForChrome();
}

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Desktop Chrome/Edge/Brave/Safari: Circle iframe storage is blocked. Use a popup. */
function preferCirclePopup(): boolean {
  if (typeof window === "undefined") return false;
  return !isMobileBrowser();
}

export const CHROME_LOGIN_HELP =
  "Allow popups for jurixai.xyz. If login still fails, in Chrome open chrome://settings/cookies → Sites allowed to use third-party cookies → Add jurixai.xyz and www.jurixai.xyz (this site, not circle.com), then refresh. Incognito usually fails.";

export function explainCircleLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "Login failed");
  const lower = raw.toLowerCase();
  if (
    lower.includes("deviceid") ||
    lower.includes("device id") ||
    lower.includes("network error") ||
    lower.includes("incorrectdeviceid") ||
    lower.includes("failed to receive") ||
    lower.includes("popup")
  ) {
    return `Chrome blocked the Circle login window. ${CHROME_LOGIN_HELP}`;
  }
  if (lower.includes("155159") || lower.includes("failed to auth to the smtp")) {
    return "Gmail rejected Circle's SMTP login. Re-save Email SMTP on Live: Host smtp.gmail.com, Port 587, Username the full Gmail address, Password the 16-character App Password with no spaces.";
  }
  if (lower.includes("155150")) {
    return "Circle email login is not set up yet. In Circle Console open Wallets → User Controlled → Configurator → Authentication Methods → Email, add SMTP (From address, host, port, username, password), save, then try again.";
  }
  if (
    /\binvalid credentials\b/.test(lower) ||
    /\bunauthorized\b/.test(lower) ||
    /\b401\b/.test(lower)
  ) {
    return raw.includes("fp ")
      ? raw
      : "Circle's Live API rejected the server key (401). In Circle Console, open the LIVE API key and turn off IP allowlist (or add Vercel), then paste that same key into Vercel as CIRCLE_API_KEY.";
  }
  return raw;
}

type LoginCallback = (
  error: CircleLoginError | undefined,
  result: CircleLoginResult | undefined,
) => void;

let cachedDeviceId: string | null = null;
let deviceIdInFlight: Promise<string> | null = null;
let activeLoginCallback: LoginCallback | undefined;
let loginInFlight = false;
let pendingSdk: W3S | null = null;
let pendingLoginConfigs: LoginConfigs | null = null;
let otpOpenedResolve: (() => void) | null = null;
let circlePopup: Window | null = null;

function readStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    return value && value.length > 8 ? value : null;
  } catch {
    return null;
  }
}

function storeDeviceId(deviceId: string): void {
  cachedDeviceId = deviceId;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  } catch {
    /* private mode */
  }
}

function markCircleIframe(node: Node): void {
  if (!(node instanceof HTMLIFrameElement)) return;
  const src = node.getAttribute("src") || node.src || "";
  const isCircle =
    node.id === "sdkIframe" || src.includes("pw-auth.circle.com") || src.includes("w3s.circle.com");
  if (!isCircle) return;

  node.setAttribute("allow", "storage-access *; clipboard-write *");
  node.allow = "storage-access *; clipboard-write *";
  node.style.pointerEvents = "auto";

  // Circle hides the device-id iframe (display:none, 0×0). Chrome often will
  // not run JS / storage in a hidden third-party iframe, so getDeviceId never
  // returns. Keep a 1×1 live frame instead.
  const isDeviceId = src.includes("device-id");
  if (isDeviceId || node.style.display === "none" || node.width === "0%") {
    node.style.display = "block";
    node.style.width = "1px";
    node.style.height = "1px";
    node.style.opacity = "0.01";
    node.style.position = "fixed";
    node.style.left = "0px";
    node.style.top = "0px";
    node.style.zIndex = "0";
    node.width = "1";
    node.height = "1";
    if (isDeviceId) node.style.pointerEvents = "none";
  } else {
    node.style.zIndex = "2147483647";
  }
}

/**
 * Chrome (PC) blocks the Circle login iframe (`pw-auth.circle.com`) unless it
 * is allowed to use third-party storage. Circle's SDK creates `#sdkIframe`
 * without `allow="storage-access"`, so getDeviceId / OTP / PIN fail with a
 * generic "Account/wallet error". Patch appendChild so the iframe is allowed
 * the moment it is mounted.
 */
let circleIframePatched = false;
function patchCircleIframeForChrome(): void {
  if (circleIframePatched || typeof Element === "undefined") return;
  circleIframePatched = true;

  const original = Node.prototype.appendChild;
  Node.prototype.appendChild = function appendChildPatched<T extends Node>(node: T): T {
    markCircleIframe(node);
    return original.call(this, node) as T;
  };

  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => markCircleIframe(node));
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

function hardenCircleIframe(): void {
  if (typeof document === "undefined") return;
  const iframe = document.getElementById("sdkIframe") as HTMLIFrameElement | null;
  if (!iframe) return;
  markCircleIframe(iframe);
}

export async function requestCircleStorageAccess(): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as Document & {
    requestStorageAccessFor?: (origin: string) => Promise<void>;
  };
  if (typeof doc.requestStorageAccessFor !== "function") return;
  for (const origin of [CIRCLE_AUTH, "https://w3s.circle.com", "https://circle.com"]) {
    try {
      await doc.requestStorageAccessFor(origin);
    } catch {
      /* origin is not in a Related Website Set — ignore */
    }
  }
}

function circlePageOrigin(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

function w3sConfigPayload(extra?: {
  challenge?: { challengeId: string };
  auth?: Session;
}): Record<string, unknown> {
  return {
    w3s: {
      appSettings: { appId: APP_ID },
      auth: extra?.auth ?? undefined,
      challenge: extra?.challenge ?? undefined,
      customizations: {
        securityQuestions: {
          questions: undefined,
          requiredCount: 2,
          securityConfirmItems: undefined,
        },
      },
      deviceInfo: { model: "Web", version: SDK_VERSION },
      socialVerification: {
        token: undefined,
        deviceToken: pendingLoginConfigs?.deviceToken,
        deviceEncryptionKey: pendingLoginConfigs?.deviceEncryptionKey,
        socialLoginProvider: undefined,
      },
      emailVerification: pendingLoginConfigs
        ? {
            deviceToken: pendingLoginConfigs.deviceToken,
            deviceEncryptionKey: pendingLoginConfigs.deviceEncryptionKey,
            otpToken: pendingLoginConfigs.otpToken,
          }
        : undefined,
    },
  };
}

function openCirclePopup(subRoute: string): Window {
  if (circlePopup && !circlePopup.closed) {
    try {
      circlePopup.location.href = `${CIRCLE_AUTH}/${subRoute}?origin=${encodeURIComponent(circlePageOrigin())}`;
      circlePopup.focus();
      return circlePopup;
    } catch {
      /* fall through and open a new one */
    }
  }
  const popup = window.open(
    `${CIRCLE_AUTH}/${subRoute}?origin=${encodeURIComponent(circlePageOrigin())}`,
    "jurix-circle-auth",
    "popup=yes,width=480,height=720",
  );
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for jurixai.xyz, then try again.");
  }
  circlePopup = popup;
  return popup;
}

function closeCirclePopup(): void {
  try {
    circlePopup?.close();
  } catch {
    /* already closed */
  }
  circlePopup = null;
}

function getDeviceIdViaPopup(): Promise<string> {
  const popup = openCirclePopup("device-id");
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      closeCirclePopup();
      reject(new Error("Failed to receive deviceId"));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
    }

    function onMsg(event: MessageEvent) {
      if (event.origin !== CIRCLE_AUTH) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;
      if (data.onFrameReady) {
        (event.source as Window | null)?.postMessage(w3sConfigPayload(), CIRCLE_AUTH);
        return;
      }
      if (typeof data.deviceId === "string" && data.deviceId) {
        cleanup();
        closeCirclePopup();
        resolve(data.deviceId);
      }
    }

    window.addEventListener("message", onMsg);
    void popup;
  });
}

function verifyOtpViaPopup(): void {
  const popup = openCirclePopup("social/verify-email");

  const onMsg = (event: MessageEvent) => {
    if (event.origin !== CIRCLE_AUTH) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data) return;

    if (data.onFrameReady) {
      (event.source as Window | null)?.postMessage(w3sConfigPayload(), CIRCLE_AUTH);
      return;
    }

    if (data.onEmailLoginVerified) {
      const verified = data.onEmailLoginVerified as {
        result?: CircleLoginResult;
        error?: CircleLoginError;
      };
      activeLoginCallback?.(verified.error, verified.result);
      if (verified.result && !verified.error) {
        window.removeEventListener("message", onMsg);
        closeCirclePopup();
      }
      return;
    }

    if (data.onResendOtpEmail && pendingSdk) {
      void applyEmailLoginTokens(pendingSdk, pendingEmail).then(() => {
        try {
          popup.postMessage(w3sConfigPayload(), CIRCLE_AUTH);
        } catch {
          /* popup gone */
        }
      });
      return;
    }

    if (data.onClose) {
      window.removeEventListener("message", onMsg);
      closeCirclePopup();
      activeLoginCallback?.({ message: "Verification was cancelled by user." }, undefined);
    }
  };

  window.addEventListener("message", onMsg);
}

let pendingEmail = "";

function extractSession(result: unknown): Session | null {
  if (!result || typeof result !== "object") return null;
  const rows: Record<string, unknown>[] = [result as Record<string, unknown>];
  const root = result as Record<string, unknown>;
  if (root.data && typeof root.data === "object") rows.push(root.data as Record<string, unknown>);
  if (root.result && typeof root.result === "object")
    rows.push(root.result as Record<string, unknown>);
  for (const row of rows) {
    const userToken = row.userToken ?? row.user_token;
    const encryptionKey = row.encryptionKey ?? row.encryption_key;
    if (
      typeof userToken === "string" &&
      typeof encryptionKey === "string" &&
      userToken &&
      encryptionKey
    ) {
      return { userToken, encryptionKey };
    }
  }
  return null;
}

async function createCircleSdk(onLoginComplete?: LoginCallback): Promise<W3S> {
  if (!APP_ID) throw new Error("Circle App ID is missing (VITE_CIRCLE_APP_ID).");
  await ensureBrowserGlobals();
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  if (onLoginComplete) activeLoginCallback = onLoginComplete;
  // W3SSdk is a singleton. Re-apply the last login callback so a warmup or PIN
  // `new W3SSdk()` does not wipe OTP completion on Chrome.
  const sdk: W3S = new W3SSdk({ appSettings: { appId: APP_ID } }, activeLoginCallback);
  hardenCircleIframe();
  pendingSdk = sdk;
  return sdk;
}

async function readDeviceId(sdk: W3S): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = readStoredDeviceId();
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  if (deviceIdInFlight) return deviceIdInFlight;

  deviceIdInFlight = (async () => {
    if (preferCirclePopup()) {
      try {
        const deviceId = await getDeviceIdViaPopup();
        if (deviceId) {
          storeDeviceId(deviceId);
          return deviceId;
        }
      } catch (err) {
        throw new Error(explainCircleLoginError(err));
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const deviceId = await sdk.getDeviceId();
        hardenCircleIframe();
        if (deviceId) {
          storeDeviceId(deviceId);
          return deviceId;
        }
      } catch (err) {
        lastError = err;
        cachedDeviceId = null;
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    throw new Error(explainCircleLoginError(lastError ?? new Error("Failed to receive deviceId")));
  })();

  try {
    return await deviceIdInFlight;
  } finally {
    deviceIdInFlight = null;
  }
}

/** Preload Circle's iframe + deviceId while the user types their email. */
export async function warmCircleLogin(): Promise<void> {
  if (loginInFlight) return;
  try {
    const sdk = await createCircleSdk();
    // Desktop Chrome cannot complete getDeviceId in a hidden iframe; opening a
    // popup here would surprise the user. Preload the SDK only. Phones still
    // warm the iframe so Send is instant.
    if (!preferCirclePopup()) {
      await readDeviceId(sdk);
    }
  } catch (err) {
    console.warn("[jurix wallet] Circle login warmup failed", err);
  }
}

type CircleChallengeResult = {
  type: string;
  status: string;
  data?: {
    signature?: string;
    txHash?: string;
    signedTransaction?: string;
  };
};

function handleLoginComplete(
  error: CircleLoginError | undefined,
  result: CircleLoginResult | undefined,
  resolveLogin: (s: Session) => void,
  rejectLogin: (e: Error) => void,
  fallbackMessage: string,
): void {
  const session = extractSession(result);
  if (session) {
    resolveLogin(session);
    return;
  }
  const errObj = error as { message?: string; code?: number } | undefined;
  if (errObj && errObj.code !== 0 && (errObj.message || errObj.code)) {
    const rawMsg = errObj.message || fallbackMessage;
    const lower = rawMsg.toLowerCase();
    const isRetryableOtp =
      lower.includes("incorrect") ||
      lower.includes("invalid otp") ||
      lower.includes("invalid code") ||
      (lower.includes("expired") && lower.includes("code"));
    // Wrong code: keep the Circle popup open so the user can retry / resend.
    if (isRetryableOtp) return;
    const isCancel =
      lower.includes("cancel") || lower.includes("close") || lower.includes("dismiss");
    rejectLogin(
      new Error(isCancel ? "Verification was cancelled by user." : explainCircleLoginError(rawMsg)),
    );
    return;
  }
  rejectLogin(new Error("Verification did not return a session."));
}

async function applyEmailLoginTokens(sdk: W3S, email: string): Promise<void> {
  const deviceId = await readDeviceId(sdk);
  const tok = await emailLoginStart({ data: { email, deviceId } });
  const otpToken = tok.otpToken;
  if (!otpToken) {
    throw new Error("Circle did not return an OTP token. Try sending the code again.");
  }
  pendingLoginConfigs = {
    deviceToken: tok.deviceToken,
    deviceEncryptionKey: tok.deviceEncryptionKey,
    otpToken,
  };
  sdk.updateConfigs(
    {
      appSettings: { appId: APP_ID },
      loginConfigs: {
        deviceToken: tok.deviceToken,
        deviceEncryptionKey: tok.deviceEncryptionKey,
        otpToken,
      },
    },
    activeLoginCallback,
  );
  hardenCircleIframe();
}

/**
 * Call from a real click after the email is sent. Desktop opens Circle as a
 * first-party window (cookies work). Phones keep Circle's iframe.
 */
export function openCircleOtpWindow(): void {
  void requestCircleStorageAccess();
  if (!pendingSdk) {
    otpOpenedResolve?.();
    otpOpenedResolve = null;
    return;
  }
  if (preferCirclePopup()) {
    verifyOtpViaPopup();
  } else {
    if (typeof pendingSdk.setOnResendOtpEmail === "function") {
      pendingSdk.setOnResendOtpEmail(() => {
        void applyEmailLoginTokens(pendingSdk, pendingEmail).catch((err) => {
          console.warn("[jurix wallet] resend OTP failed", err);
        });
      });
    }
    pendingSdk.verifyOtp();
    hardenCircleIframe();
  }
  otpOpenedResolve?.();
  otpOpenedResolve = null;
}

async function waitForEmailOtpSession(
  email: string,
  fallbackMessage: string,
  onOtpSent?: () => void,
  options?: { waitForOpenClick?: boolean },
): Promise<{ sdk: W3S; session: Session }> {
  let resolveLogin!: (s: Session) => void;
  let rejectLogin!: (e: Error) => void;
  const loginDone = new Promise<Session>((res, rej) => {
    resolveLogin = res;
    rejectLogin = rej;
  });
  let settled = false;
  const resolveOnce = (s: Session) => {
    if (settled) return;
    settled = true;
    resolveLogin(s);
  };
  const rejectOnce = (e: Error) => {
    if (settled) return;
    settled = true;
    rejectLogin(e);
  };

  // Keep this synchronous so a user click can still open a Circle popup
  // (desktop Chrome blocks the iframe and also blocks popups after `await`).
  if (preferCirclePopup()) {
    try {
      if (!cachedDeviceId && !readStoredDeviceId()) {
        openCirclePopup("device-id");
      } else if (!options?.waitForOpenClick) {
        openCirclePopup("social/verify-email");
      }
    } catch {
      /* iframe fallback if popups are blocked */
    }
  }

  const sdk = await createCircleSdk((error, result) =>
    handleLoginComplete(error, result, resolveOnce, rejectOnce, fallbackMessage),
  );

  const onCircleMessage = (event: MessageEvent) => {
    const origin = String(event.origin || "");
    if (!origin.includes("circle.com")) return;
    const data = event.data as Record<string, unknown> | null;
    const verified = data?.onEmailLoginVerified as
      { result?: unknown; error?: unknown } | undefined;
    if (!verified) return;
    handleLoginComplete(
      verified.error as CircleLoginError | undefined,
      verified.result as CircleLoginResult | undefined,
      resolveOnce,
      rejectOnce,
      fallbackMessage,
    );
  };
  if (typeof window !== "undefined") {
    window.addEventListener("message", onCircleMessage);
  }

  loginInFlight = true;
  pendingEmail = email;
  try {
    await applyEmailLoginTokens(sdk, email);
    if (typeof sdk.setOnResendOtpEmail === "function") {
      sdk.setOnResendOtpEmail(() => {
        void applyEmailLoginTokens(sdk, email).catch((err) => {
          console.warn("[jurix wallet] resend OTP failed", err);
        });
      });
    }
    onOtpSent?.();

    if (options?.waitForOpenClick) {
      await new Promise<void>((resolve) => {
        otpOpenedResolve = resolve;
      });
    } else {
      openCircleOtpWindow();
    }

    const session = await Promise.race([
      loginDone,
      new Promise<Session>((_, rej) => {
        window.setTimeout(() => {
          rej(
            new Error(
              "Circle did not finish email verification. Allow this site to use third-party cookies, or allow the Circle popup, then try again.",
            ),
          );
        }, 180000);
      }),
    ]);
    return { sdk, session };
  } finally {
    loginInFlight = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("message", onCircleMessage);
    }
  }
}

/** Initiate email OTP login and return the session token when verified. */
export async function getEmailSession(email: string): Promise<Session> {
  const { session } = await waitForEmailOtpSession(email, "Email verification failed.");
  return session;
}

function executeChallengeViaPopup(
  challengeId: string,
  auth: Session,
): Promise<CircleChallengeResult> {
  const popup = openCirclePopup("");
  return new Promise<CircleChallengeResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Circle PIN window timed out. Allow the popup and try again."));
    }, 180000);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
    }

    function onMsg(event: MessageEvent) {
      if (event.origin !== CIRCLE_AUTH) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;

      if (data.onFrameReady) {
        (event.source as Window | null)?.postMessage(
          w3sConfigPayload({ challenge: { challengeId }, auth }),
          CIRCLE_AUTH,
        );
        return;
      }

      if (data.onComplete) {
        cleanup();
        closeCirclePopup();
        const result = data.result as CircleChallengeResult | undefined;
        if (!result) {
          reject(new Error("Challenge finished without a result."));
          return;
        }
        resolve(result);
        return;
      }

      if (data.onError) {
        cleanup();
        closeCirclePopup();
        const err = data.error as { message?: string } | undefined;
        reject(new Error(err?.message || "Challenge failed."));
        return;
      }

      if (data.onClose) {
        cleanup();
        closeCirclePopup();
        reject(new Error("Verification was cancelled by user."));
      }
    }

    window.addEventListener("message", onMsg);
    void popup;
  });
}

/** Run a Circle challenge (PIN setup / signing) on an existing SDK instance. */
export function runChallenge(
  sdk: W3S,
  challengeId: string,
  auth?: Session,
): Promise<CircleChallengeResult> {
  if (preferCirclePopup() && auth) {
    toast.info("Launching secure challenge window...");
    return executeChallengeViaPopup(challengeId, auth);
  }

  return new Promise<CircleChallengeResult>((resolve, reject) => {
    toast.info("Launching secure challenge window...", {
      description: `Challenge ID: ${challengeId.substring(0, 8)}...`,
    });

    hardenCircleIframe();
    sdk.execute(
      challengeId,
      (error: { message?: string } | undefined, result: CircleChallengeResult | undefined) => {
        if (error) {
          const rawMsg = error.message || "Challenge failed.";
          toast.error("Challenge verification failed", { description: rawMsg });
          const isCancel =
            rawMsg.toLowerCase().includes("cancel") ||
            rawMsg.toLowerCase().includes("close") ||
            rawMsg.toLowerCase().includes("dismiss");
          reject(new Error(isCancel ? "Verification was cancelled by user." : rawMsg));
          return;
        }

        if (!result) {
          reject(new Error("Challenge finished without a result."));
          return;
        }

        if (result.status === "FAILED" || result.status === "EXPIRED") {
          reject(new Error(`Challenge ended with status ${result.status.toLowerCase()}.`));
          return;
        }

        toast.success("Verification captured successfully.");
        resolve(result);
      },
    );
    window.setTimeout(() => {
      const pinIframe = document.getElementById("sdkIframe") as HTMLIFrameElement | null;
      if (!pinIframe) return;
      pinIframe.style.display = "";
      pinIframe.style.zIndex = "2147483647";
      pinIframe.style.position = "fixed";
      pinIframe.style.inset = "0";
      pinIframe.width = "100%";
      pinIframe.height = "100%";
      hardenCircleIframe();
    }, 400);
  });
}

/** Poll for the wallet address (it materializes shortly after the PIN ceremony). */
async function waitForWalletAddress(userToken: string, tries = 30): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await listUserWallets({ data: { userToken } });
      if (list && list.address) return list.address;
    } catch (e) {
      console.warn("[waitForWalletAddress] polling error (retrying):", e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "";
}

/**
 * Full email sign-in: OTP → (first time) set a PIN + create the Arc wallet →
 * return the wallet. A single SDK instance handles both the OTP and the PIN
 * challenge.
 */
export async function emailSignIn(
  email: string,
  onStatusUpdate?: (status: string) => void,
): Promise<CircleWallet> {
  onStatusUpdate?.("sending_otp");
  const { sdk, session } = await waitForEmailOtpSession(
    email,
    "Email login failed.",
    () => onStatusUpdate?.("awaiting_otp"),
    { waitForOpenClick: true },
  );
  onStatusUpdate?.("verifying_wallet");
  // First-time users have no wallet yet. Reuse THIS sdk instance for the PIN
  // ceremony — Circle's W3SSdk is a singleton, and a second `new W3SSdk()`
  // plus removing the iframe leaves the PIN screen blank on Chrome.
  const prov = await provisionWallet({ data: { userToken: session.userToken, email } });
  let address = prov.address ?? "";
  if (!address && prov.challengeId) {
    onStatusUpdate?.("awaiting_pin");
    sdk.setAuthentication({
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
    });
    hardenCircleIframe();
    await runChallenge(sdk, prov.challengeId, session);

    onStatusUpdate?.("polling_address");
    address = await waitForWalletAddress(session.userToken, 45);
  }

  if (!address) {
    throw new Error("Wallet not ready yet — please try signing in again.");
  }
  return { identifier: email, address, chain: CHAIN, authMethod: "email" };
}

/**
 * Execute a USDC transfer out of the user's smart wallet to a destination EVM address.
 * Initiates an email OTP session for authorization, generates the challenge, and prompts the user's PIN.
 */
export async function executeWithdrawal(
  email: string,
  recipientAddress: string,
  amount: number,
): Promise<void> {
  const { createWithdrawalTransaction } = await import("./userWallet.server");
  const tid = toast.loading("Initiating secure transaction...");

  try {
    const { sdk, session } = await waitForEmailOtpSession(
      email,
      "Email verification failed.",
      () => {
        toast.loading("Email sent. Enter the code in the Circle window, then your 6-digit PIN.", {
          id: tid,
        });
      },
    );

    toast.loading("Email verified. Creating the Arc USDC transfer…", { id: tid });
    const tx = await createWithdrawalTransaction({
      data: {
        userToken: session.userToken,
        recipientAddress,
        amount,
      },
    });

    if (!tx.challengeId) {
      throw new Error("Failed to generate withdrawal challenge.");
    }

    sdk.setAuthentication({
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
    });
    hardenCircleIframe();

    toast.loading("Keypad loading. Please enter your secure PIN when the keyboard pops up.", {
      id: tid,
    });
    await runChallenge(sdk, tx.challengeId, session);
    toast.success("Transaction authorized successfully!", { id: tid });
  } catch (err) {
    toast.dismiss(tid);
    throw err instanceof Error ? new Error(explainCircleLoginError(err)) : err;
  }
}
