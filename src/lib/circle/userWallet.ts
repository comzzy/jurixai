/**
 * Circle User-Controlled Wallets — BROWSER flow (email OTP + PIN) on Arc.
 *
 * Uses @circle-fin/w3s-pw-web-sdk (dynamically imported so it stays out of the
 * SSR bundle). IMPORTANT: a single SDK instance is reused across the OTP login
 * and the PIN-setup challenge. Creating a second instance for the challenge
 * leaves Circle's PIN screen unrendered.
 *
 * Circle's auth UI only postMessages to window.parent, so a popup cannot
 * complete login. Chrome on a computer also skips JS in display:none / 0×0
 * third-party iframes, which is why getDeviceId used to fail with a cookies
 * error. We force Circle's iframe to stay a real on-screen window.
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
const STAGE_ID = "jurix-circle-stage";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W3S = any;

type LoginCallback = (
  error: CircleLoginError | undefined,
  result: CircleLoginResult | undefined,
) => void;

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

export const CHROME_LOGIN_HELP =
  "Hard-refresh this page (Ctrl+Shift+R). Circle stays on this page — if Chrome opened a separate Circle tab, close it. Then chrome://settings/cookies → Sites allowed to use third-party cookies → Add jurixai.xyz and www.jurixai.xyz (this site). Do not use Incognito.";

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

let cachedDeviceId: string | null = null;
let deviceIdInFlight: Promise<string> | null = null;
let activeLoginCallback: LoginCallback | undefined;
let loginInFlight = false;
let pendingSdk: W3S | null = null;
let pendingEmail = "";
let overlayCancel: (() => void) | null = null;
let loginCancelled = false;

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

function circleStageCard(): HTMLElement | null {
  return document.getElementById(`${STAGE_ID}-card`);
}

function setCircleStageStatus(text: string): void {
  const el = document.getElementById(`${STAGE_ID}-status`);
  if (el) el.textContent = text;
}

function ensureCircleStage(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let stage = document.getElementById(STAGE_ID);
  if (stage) return stage;

  stage = document.createElement("div");
  stage.id = STAGE_ID;
  stage.setAttribute("data-jurix-circle", "1");
  stage.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483646",
    "background:rgba(15,18,22,0.55)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "pointer-events:auto",
    "padding:16px",
  ].join(";");

  const card = document.createElement("div");
  card.id = `${STAGE_ID}-card`;
  card.style.cssText = [
    "position:relative",
    "width:min(480px, 100%)",
    "height:min(640px, 100%)",
    "background:#fff",
    "border-radius:12px",
    "overflow:hidden",
    "box-shadow:0 24px 64px rgba(0,0,0,0.35)",
    "display:flex",
    "flex-direction:column",
  ].join(";");

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#f4f6f8;color:#1b1f24;font:600 13px/1.3 system-ui,sans-serif;";
  const status = document.createElement("p");
  status.id = `${STAGE_ID}-status`;
  status.style.cssText = "margin:0;flex:1;";
  status.textContent = "Connecting to Circle…";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close Circle login");
  close.textContent = "×";
  close.style.cssText =
    "border:0;background:transparent;color:#1b1f24;font-size:22px;line-height:1;cursor:pointer;padding:0 4px;";
  close.addEventListener("click", () => {
    overlayCancel?.();
    overlayCancel = null;
    removeCircleStage();
  });
  bar.append(status, close);
  card.append(bar);
  stage.append(card);
  document.body.appendChild(stage);
  return stage;
}

function removeCircleStage(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STAGE_ID)?.remove();
}

function isCircleIframe(node: HTMLIFrameElement): boolean {
  const src = node.getAttribute("src") || node.src || "";
  return (
    node.id === "sdkIframe" || src.includes("pw-auth.circle.com") || src.includes("w3s.circle.com")
  );
}

let applyingCircleIframeStyle = false;
function markCircleIframe(node: Node): void {
  if (applyingCircleIframeStyle) return;
  if (!(node instanceof HTMLIFrameElement) || !isCircleIframe(node)) return;

  const src = node.getAttribute("src") || node.src || "";
  applyingCircleIframeStyle = true;

  node.setAttribute("allow", "storage-access *; clipboard-write *");
  node.allow = "storage-access *; clipboard-write *";
  node.removeAttribute("hidden");
  node.loading = "eager";

  // Chrome skips JS in display:none / 0×0 third-party iframes. Keep every
  // Circle frame (device-id, OTP, PIN) as a real on-page window. Circle posts
  // to window.parent, so a popup to pw-auth.circle.com can never finish login.
  ensureCircleStage();
  if (src.includes("verify-email")) {
    setCircleStageStatus("Enter the code from your email");
  } else if (src.includes("device-id")) {
    setCircleStageStatus("Connecting to Circle…");
  } else {
    setCircleStageStatus("Enter your 6-digit PIN");
  }

  node.style.cssText = [
    "flex:1",
    "width:100%",
    "height:100%",
    "min-height:520px",
    "border:0",
    "background:#fff",
    "display:block",
    "opacity:1",
    "pointer-events:auto",
  ].join(";");
  node.width = "480";
  node.height = "640";
  applyingCircleIframeStyle = false;
}

let circleIframePatched = false;
function patchCircleIframeForChrome(): void {
  if (circleIframePatched || typeof Element === "undefined") return;
  circleIframePatched = true;

  const originalAppend = Node.prototype.appendChild;
  Node.prototype.appendChild = function appendChildPatched<T extends Node>(node: T): T {
    if (node instanceof HTMLIFrameElement && isCircleIframe(node)) {
      markCircleIframe(node);
      const card = circleStageCard();
      if (card && this !== card) {
        return originalAppend.call(card, node) as T;
      }
    }
    return originalAppend.call(this, node) as T;
  };

  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => markCircleIframe(node));
        if (record.type === "attributes" && record.target instanceof HTMLIFrameElement) {
          markCircleIframe(record.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
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
      /* not in a Related Website Set */
    }
  }
}

function extractSession(result: unknown): Session | null {
  if (!result || typeof result !== "object") return null;
  const rows: Record<string, unknown>[] = [result as Record<string, unknown>];
  const root = result as Record<string, unknown>;
  if (root.data && typeof root.data === "object") rows.push(root.data as Record<string, unknown>);
  if (root.result && typeof root.result === "object") {
    rows.push(root.result as Record<string, unknown>);
  }
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
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (loginCancelled) throw new Error("Verification was cancelled by user.");
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
        if (loginCancelled) throw new Error("Verification was cancelled by user.");
        await new Promise((r) => setTimeout(r, 600));
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

/** Preload Circle's SDK while the user types their email. Skip getDeviceId —
 *  desktop Chrome would otherwise flash a blank Circle frame before Send. */
export async function warmCircleLogin(): Promise<void> {
  if (loginInFlight) return;
  try {
    await createCircleSdk();
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

export function openCircleOtpWindow(): void {
  if (!pendingSdk) return;
  if (typeof pendingSdk.setOnResendOtpEmail === "function") {
    pendingSdk.setOnResendOtpEmail(() => {
      void applyEmailLoginTokens(pendingSdk, pendingEmail).catch((err) => {
        console.warn("[jurix wallet] resend OTP failed", err);
      });
    });
  }
  pendingSdk.verifyOtp();
  hardenCircleIframe();
  window.setTimeout(() => hardenCircleIframe(), 300);
  window.setTimeout(() => hardenCircleIframe(), 1200);
}

async function waitForEmailOtpSession(
  email: string,
  fallbackMessage: string,
  onOtpSent?: () => void,
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
  loginCancelled = false;
  pendingEmail = email;
  overlayCancel = () => {
    loginCancelled = true;
    rejectOnce(new Error("Verification was cancelled by user."));
  };
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
    openCircleOtpWindow();

    const session = await Promise.race([
      loginDone,
      new Promise<Session>((_, rej) => {
        window.setTimeout(() => {
          rej(
            new Error(
              "Circle did not finish email verification. Hard-refresh, then allow this site to use third-party cookies and try again.",
            ),
          );
        }, 180000);
      }),
    ]);
    return { sdk, session };
  } catch (err) {
    removeCircleStage();
    throw err;
  } finally {
    loginInFlight = false;
    overlayCancel = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("message", onCircleMessage);
    }
  }
}

export async function getEmailSession(email: string): Promise<Session> {
  const { session } = await waitForEmailOtpSession(email, "Email verification failed.");
  return session;
}

export function runChallenge(
  sdk: W3S,
  challengeId: string,
  _auth?: Session,
): Promise<CircleChallengeResult> {
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
    window.setTimeout(() => hardenCircleIframe(), 400);
    window.setTimeout(() => hardenCircleIframe(), 1500);
  });
}

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

export async function emailSignIn(
  email: string,
  onStatusUpdate?: (status: string) => void,
): Promise<CircleWallet> {
  try {
    onStatusUpdate?.("sending_otp");
    const { sdk, session } = await waitForEmailOtpSession(email, "Email login failed.", () =>
      onStatusUpdate?.("awaiting_otp"),
    );
    onStatusUpdate?.("verifying_wallet");
    setCircleStageStatus("Connecting wallet…");
    const prov = await provisionWallet({ data: { userToken: session.userToken, email } });
    let address = prov.address ?? "";
    if (!address && prov.challengeId) {
      onStatusUpdate?.("awaiting_pin");
      setCircleStageStatus("Enter your 6-digit PIN");
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
  } finally {
    removeCircleStage();
  }
}

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
        toast.loading("Email sent. Enter the code in the Circle panel, then your 6-digit PIN.", {
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
    removeCircleStage();
  } catch (err) {
    toast.dismiss(tid);
    removeCircleStage();
    throw err instanceof Error ? new Error(explainCircleLoginError(err)) : err;
  }
}
