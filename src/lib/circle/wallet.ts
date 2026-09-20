/**
 * Circle Modular Wallets — BROWSER ONLY.
 *
 * Creates passkey-secured smart-contract wallets (ERC-4337) and reads the
 * Circle publishable client key + RPC URL from VITE_ env vars. The SDK uses
 * WebAuthn (passkeys), which only exist in the browser, so it is dynamically
 * imported here to keep it out of the server/SSR bundle.
 */

const CLIENT_KEY = import.meta.env.VITE_CIRCLE_CLIENT_KEY as string | undefined;
const CLIENT_URL = import.meta.env.VITE_CIRCLE_CLIENT_URL as string | undefined;
const CHAIN = (import.meta.env.VITE_CIRCLE_CHAIN as string | undefined) || "ARC";

import type { AuthMethod } from "@/lib/account/types";

export interface CircleWallet {
  identifier: string;
  address: string;
  chain: string;
  authMethod: AuthMethod;
}

/** True when the Circle publishable keys are present in this build. */
export function isWalletConfigured(): boolean {
  return Boolean(CLIENT_KEY && CLIENT_URL);
}

/** The chain new passkey wallets are created on. */
export function walletChain(): string {
  return CHAIN;
}

async function buildSmartAccount(username: string, mode: "register" | "login"): Promise<string> {
  if (!CLIENT_KEY || !CLIENT_URL) {
    throw new Error(
      "Circle wallet is not configured. Set VITE_CIRCLE_CLIENT_KEY and VITE_CIRCLE_CLIENT_URL.",
    );
  }

  const {
    toPasskeyTransport,
    toWebAuthnCredential,
    toModularTransport,
    toCircleSmartAccount,
    WebAuthnMode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = (await import("@circle-fin/modular-wallets-core")) as any;
  const { createPublicClient } = await import("viem");
  const { toWebAuthnAccount } = await import("viem/account-abstraction");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chains = (await import("viem/chains")) as Record<string, any>;

  const chain = chains[CHAIN];
  if (!chain) throw new Error(`Unknown chain "${CHAIN}".`);

  // 1. Register or log in with a passkey.
  const passkeyTransport = toPasskeyTransport(CLIENT_URL, CLIENT_KEY);
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport,
    mode: mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login,
    username,
  });

  // 2. Build a client for the chosen chain and derive the Circle smart account.
  const modularTransport = toModularTransport(`${CLIENT_URL}/${CHAIN}`, CLIENT_KEY);
  const client = createPublicClient({ chain, transport: modularTransport });
  const smartAccount = await toCircleSmartAccount({
    client,
    owner: toWebAuthnAccount({ credential }),
  });

  return smartAccount.address as string;
}

/** Register a new passkey and create the user's Circle smart wallet. */
export async function createWallet(username: string): Promise<CircleWallet> {
  const address = await buildSmartAccount(username, "register");
  return { identifier: username, address, chain: CHAIN, authMethod: "passkey" };
}

/** Log in with an existing passkey and re-derive the user's wallet address. */
export async function loginWallet(username: string): Promise<CircleWallet> {
  const address = await buildSmartAccount(username, "login");
  return { identifier: username, address, chain: CHAIN, authMethod: "passkey" };
}
