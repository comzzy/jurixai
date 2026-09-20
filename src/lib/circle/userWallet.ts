/**
 * Circle User-Controlled Wallets — BROWSER flow (email OTP + PIN) on Arc.
 *
 * Uses @circle-fin/w3s-pw-web-sdk (dynamically imported so it stays out of the
 * SSR bundle). IMPORTANT: a single SDK instance is reused across the OTP login
 * and the PIN-setup challenge. Creating a second instance for the challenge (as
 * the old code did) leaves Circle's PIN screen unrendered, so the flow hangs on
 * "creating" forever. This mirrors Circle's own reference apps (e.g. Polaris).
 */
import { emailLoginStart, provisionWallet, listUserWallets } from "./userWallet.server";
import type { CircleWallet } from "./wallet";
import { toast } from "sonner";
import { CHAIN_DISPLAY_NAME, CIRCLE_CHAIN_CODE } from "@/lib/chain";
import { circleAppId } from "./appId";

const APP_ID = circleAppId();
const CHAIN = CIRCLE_CHAIN_CODE;

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
    // @ts-ignore
    const proc = (await import("process/browser")) as { default?: unknown };
    g.process = proc.default ?? proc;
  }
  const p = g.process as Record<string, unknown> | undefined;
  if (p && !p.env) {
    p.env = {};
  }
  patchCircleIframeForChrome();
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
  const original = Element.prototype.appendChild;
  Element.prototype.appendChild = function appendChildPatched<T extends Node>(node: T): T {
    if (node instanceof HTMLIFrameElement) {
      const src = node.getAttribute("src") || node.src || "";
      if (node.id === "sdkIframe" || src.includes("pw-auth.circle.com") || src.includes("w3s.circle.com")) {
        node.setAttribute("allow", "storage-access *; clipboard-write *");
        node.allow = "storage-access *; clipboard-write *";
        node.style.pointerEvents = "auto";
      }
    }
    return original.call(this, node) as T;
  };
}

function hardenCircleIframe(): void {
  if (typeof document === "undefined") return;
  const iframe = document.getElementById("sdkIframe") as HTMLIFrameElement | null;
  if (!iframe) return;
  iframe.setAttribute("allow", "storage-access *; clipboard-write *");
  iframe.allow = "storage-access *; clipboard-write *";
  iframe.style.pointerEvents = "auto";
}

export const CHROME_LOGIN_HELP =
  "Chrome on a computer often blocks the Circle login window. In Chrome open Settings → Privacy and security → Third-party cookies, choose Allow third-party cookies (or add [*.]circle.com), then refresh this page.";

export function explainCircleLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "Login failed");
  const lower = raw.toLowerCase();
  if (
    lower.includes("deviceid") ||
    lower.includes("device id") ||
    lower.includes("network error") ||
    lower.includes("incorrectdeviceid") ||
    lower.includes("failed to receive")
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

type LoginCallback = (error: CircleLoginError | undefined, result: CircleLoginResult | undefined) => void;

let cachedDeviceId: string | null = null;
let activeLoginCallback: LoginCallback | undefined;

async function createCircleSdk(onLoginComplete?: LoginCallback): Promise<W3S> {
  if (!APP_ID) throw new Error("Circle App ID is missing (VITE_CIRCLE_APP_ID).");
  await ensureBrowserGlobals();
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  if (onLoginComplete) activeLoginCallback = onLoginComplete;
  // W3SSdk is a singleton. Re-apply the last login callback so a warmup or PIN
  // `new W3SSdk()` does not wipe OTP completion on Chrome.
  const sdk: W3S = new W3SSdk({ appSettings: { appId: APP_ID } }, activeLoginCallback);
  hardenCircleIframe();
  return sdk;
}

async function readDeviceId(sdk: W3S): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const deviceId = await sdk.getDeviceId();
      hardenCircleIframe();
      if (deviceId) {
        cachedDeviceId = deviceId;
        return deviceId;
      }
    } catch (err) {
      lastError = err;
      cachedDeviceId = null;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error(explainCircleLoginError(lastError ?? new Error("Failed to receive deviceId")));
}

/** Preload Circle's iframe + deviceId while the user types their email. */
export async function warmCircleLogin(): Promise<void> {
  try {
    const sdk = await createCircleSdk();
    await readDeviceId(sdk);
  } catch (err) {
    // eslint-disable-next-line no-console
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
  if (error) {
    const rawMsg = error?.message || fallbackMessage;
    const isCancel =
      rawMsg.toLowerCase().includes("cancel") ||
      rawMsg.toLowerCase().includes("close") ||
      rawMsg.toLowerCase().includes("dismiss");
    rejectLogin(new Error(isCancel ? "Verification was cancelled by user." : explainCircleLoginError(rawMsg)));
    return;
  }
  const userToken = result?.userToken ?? result?.data?.userToken;
  const encryptionKey = result?.encryptionKey ?? result?.data?.encryptionKey;
  if (!userToken || !encryptionKey) {
    rejectLogin(new Error("Verification did not return a session."));
    return;
  }
  resolveLogin({ userToken, encryptionKey });
}

async function startEmailOtp(sdk: W3S, email: string): Promise<void> {
  const deviceId = await readDeviceId(sdk);
  const tok = await emailLoginStart({ data: { email, deviceId } });
  sdk.updateConfigs({
    appSettings: { appId: APP_ID },
    loginConfigs: {
      deviceToken: tok.deviceToken,
      deviceEncryptionKey: tok.deviceEncryptionKey,
      otpToken: tok.otpToken,
    },
  });
  hardenCircleIframe();
  sdk.verifyOtp();
  hardenCircleIframe();
}

/** Initiate email OTP login and return the session token when verified. */
export async function getEmailSession(email: string): Promise<Session> {
  let resolveLogin!: (s: Session) => void;
  let rejectLogin!: (e: Error) => void;
  const loginDone = new Promise<Session>((res, rej) => {
    resolveLogin = res;
    rejectLogin = rej;
  });

  const sdk = await createCircleSdk((error, result) =>
    handleLoginComplete(error, result, resolveLogin, rejectLogin, "Email verification failed."),
  );
  await startEmailOtp(sdk, email);
  return loginDone;
}

/** Run a Circle challenge (PIN setup / signing) on an existing SDK instance. */
export function runChallenge(sdk: W3S, challengeId: string): Promise<CircleChallengeResult> {
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
  let resolveLogin!: (s: Session) => void;
  let rejectLogin!: (e: Error) => void;
  const loginDone = new Promise<Session>((res, rej) => {
    resolveLogin = res;
    rejectLogin = rej;
  });

  const sdk = await createCircleSdk((error, result) =>
    handleLoginComplete(error, result, resolveLogin, rejectLogin, "Email login failed."),
  );

  onStatusUpdate?.("sending_otp");
  await startEmailOtp(sdk, email);
  onStatusUpdate?.("awaiting_otp");

  const session = await loginDone;

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
    await runChallenge(sdk, prov.challengeId);

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
    let resolveLogin!: (s: Session) => void;
    let rejectLogin!: (e: Error) => void;
    const loginDone = new Promise<Session>((res, rej) => {
      resolveLogin = res;
      rejectLogin = rej;
    });

    const sdk = await createCircleSdk((error, result) =>
      handleLoginComplete(error, result, resolveLogin, rejectLogin, "Email verification failed."),
    );

    await startEmailOtp(sdk, email);
    toast.loading("Email verification code sent. Please enter the code in the secure window.", {
      id: tid,
    });

    const session = await loginDone;

    toast.loading("Email verified! Generating secure payment challenge...", { id: tid });
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
    await runChallenge(sdk, tx.challengeId);
    toast.success("Transaction authorized successfully!", { id: tid });
  } catch (err) {
    toast.dismiss(tid);
    throw err instanceof Error ? new Error(explainCircleLoginError(err)) : err;
  }
}
