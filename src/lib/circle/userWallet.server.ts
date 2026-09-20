/**
 * Circle User-Controlled Wallets — SERVER functions.
 *
 * These run only on the server (TanStack server functions) and use the secret
 * CIRCLE_API_KEY to talk to Circle. The key is never sent to the browser.
 *
 * Flow: the browser gets a deviceId, we mint an email-login device token
 * (Circle emails the OTP), the browser SDK collects the code and returns a
 * userToken, then we create / list the user's wallet with that userToken.
 */
import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { createPublicClient, erc20Abi, http, parseUnits } from "viem";
import {
  ARC_RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  CIRCLE_CHAIN_CODE,
  CHAIN_DISPLAY_NAME,
  IS_TESTNET,
  activeChain,
} from "@/lib/chain";

const CHAIN = CIRCLE_CHAIN_CODE;
const CIRCLE_LIVE_API = "https://api.circle.com";
/** Circle's edge WAF returns 401/403 for empty or datacenter User-Agents. */
const CIRCLE_USER_AGENT =
  "Mozilla/5.0 (compatible; JuriXAI/1.0; +https://www.jurixai.xyz) Chrome/120.0.0.0";

function pickWalletOnActiveChain<T extends { blockchain?: string | null; address?: string | null; id?: string | null }>(
  wallets: T[],
): T | undefined {
  const wanted = CHAIN.toUpperCase();
  return (
    wallets.find((w) => (w.blockchain ?? "").toUpperCase() === wanted) ??
    (wanted === "ARC" ? wallets.find((w) => (w.blockchain ?? "").toUpperCase() === "ARC-MAINNET") : undefined)
  );
}

function circleApiKey(): string {
  return (process.env.CIRCLE_API_KEY ?? "").trim();
}

function client() {
  const apiKey = circleApiKey();
  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not set on the server (add it in Vercel).");
  }
  return initiateUserControlledWalletsClient({
    apiKey,
    baseUrl: CIRCLE_LIVE_API,
    userAgent: CIRCLE_USER_AGENT,
  });
}

async function circleFetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const apiKey = circleApiKey();
  if (!apiKey) {
    return { status: 0, json: null, text: "CIRCLE_API_KEY missing" };
  }
  const res = await fetch(`${CIRCLE_LIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": CIRCLE_USER_AGENT,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

type CreateTransactionInput = Parameters<ReturnType<typeof client>["createTransaction"]>[0];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function circleKeyKind(): "LIVE" | "TEST" | "MISSING" | "OTHER" {
  const key = circleApiKey();
  if (!key) return "MISSING";
  if (key.startsWith("LIVE_API_KEY")) return "LIVE";
  if (key.startsWith("TEST_API_KEY")) return "TEST";
  return "OTHER";
}

function keyFingerprint(): { keyLen: number; keySha12: string } {
  const key = circleApiKey();
  return {
    keyLen: key.length,
    keySha12: key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "",
  };
}

function circleErrorMessage(
  json: Record<string, unknown> | null,
  text: string,
  fallback: string,
): { code: number | undefined; message: string } {
  const data = json && typeof json === "object" ? json : null;
  const nested = (data?.data && typeof data.data === "object" ? data.data : null) as Record<
    string,
    unknown
  > | null;
  const codeRaw = data?.code ?? nested?.code;
  const code = typeof codeRaw === "number" ? codeRaw : undefined;
  const message =
    (typeof data?.message === "string" && data.message) ||
    (typeof nested?.message === "string" && nested.message) ||
    text.slice(0, 180) ||
    fallback;
  return { code, message };
}

/** Report whether the server has the minimum config required for email login. */
export const emailLoginStatus = createServerFn({ method: "GET" }).handler(async () => {
  const kind = circleKeyKind();
  const fp = keyFingerprint();
  let entityStatus = 0;
  let entityAppIdPrefix = "";
  let entityMessage = "";
  if (kind !== "MISSING") {
    const probe = await circleFetchJson("/v1/w3s/config/entity");
    entityStatus = probe.status;
    const data = probe.json?.data as { appId?: string } | undefined;
    entityAppIdPrefix = (data?.appId ?? "").slice(0, 8);
    entityMessage = circleErrorMessage(probe.json, probe.text, probe.status === 200 ? "ok" : "entity probe failed").message;
  }
  return {
    configured: kind === "LIVE" && entityStatus === 200,
    apiKeyConfigured: kind !== "MISSING",
    apiKeyKind: kind,
    circleEnv: (process.env.CIRCLE_ENV ?? "").trim() || "unset",
    chain: CHAIN,
    keyLen: fp.keyLen,
    keySha12: fp.keySha12,
    entityStatus,
    entityAppIdPrefix,
    entityMessage,
  };
});

/** Mint a device token for email login — triggers Circle to email the OTP code. */
export const emailLoginStart = createServerFn({ method: "POST" })
  .validator((d: { email: string; deviceId: string }) => d)
  .handler(async ({ data }) => {
    const kind = circleKeyKind();
    if (kind !== "LIVE") {
      throw new Error(
        `Circle login is not using the LIVE API key (server has ${kind}). Set CIRCLE_API_KEY=LIVE_API_KEY:... on Vercel production.`,
      );
    }
    const probe = await circleFetchJson("/v1/w3s/users/email/token", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        deviceId: data.deviceId,
        email: data.email,
      }),
    });
    const payload = (probe.json?.data ?? null) as {
      deviceToken?: string;
      deviceEncryptionKey?: string;
      otpToken?: string;
    } | null;
    if (probe.status >= 200 && probe.status < 300 && payload?.deviceToken && payload.deviceEncryptionKey) {
      return {
        deviceToken: payload.deviceToken,
        deviceEncryptionKey: payload.deviceEncryptionKey,
        otpToken: payload.otpToken,
      };
    }
    const { code, message } = circleErrorMessage(probe.json, probe.text, "Circle email login failed");
    if (code === 155150 || /smtp/i.test(message)) {
      throw new Error(
        "Circle login failed (155150): SMTP is not configured on the Live User-Controlled Wallets app. In Circle Console open Wallets → User Controlled → Configurator → Authentication Methods → Email and save SMTP, then try email login again.",
      );
    }
    if (probe.status === 401 || /invalid credentials/i.test(message)) {
      const fp = keyFingerprint();
      throw new Error(
        `Circle login failed (401): Live API rejected the server key (len ${fp.keyLen}, fp ${fp.keySha12}). In Circle Console check the LIVE API key is not IP-restricted, then set that same key as CIRCLE_API_KEY on Vercel production.`,
      );
    }
    throw new Error(
      code
        ? `Circle login failed (${code}, HTTP ${probe.status}): ${message}`
        : `Circle login failed (HTTP ${probe.status}): ${message}`,
    );
  });

/** Ensure the logged-in user has a wallet; create one if not. */
export const provisionWallet = createServerFn({ method: "POST" })
  .validator((d: { userToken: string; email: string }) => d)
  .handler(async ({ data }) => {
    const c = client();
    const existing = await c.listWallets({ userToken: data.userToken });
    const wallets = existing.data?.wallets ?? [];
    const onActiveChain = pickWalletOnActiveChain(wallets);
    if (onActiveChain?.address) {
      return { challengeId: null as string | null, address: onActiveChain.address };
    }
    if (wallets.length > 0) {
      const created = await c.createWallet({
        userToken: data.userToken,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blockchains: [CHAIN as any],
        accountType: "SCA",
      });
      return {
        challengeId: created.data?.challengeId ?? null,
        address: null as string | null,
      };
    }
    // First-time user: no PIN and no wallet yet. createUserPinWithWallets sets a
    // PIN and creates the wallet(s) in one challenge (createWallet alone assumes a
    // PIN already exists, which is why the old flow hung on first login).
    const circleEnv = (process.env.CIRCLE_ENV ?? "").trim().toLowerCase();
    const apiKey = process.env.CIRCLE_API_KEY ?? "";
    const isLiveCircle =
      circleEnv === "production" || apiKey.startsWith("LIVE_API_KEY");
    if (!IS_TESTNET && !isLiveCircle) {
      throw new Error(
        `Circle sandbox cannot create wallets on ${CHAIN_DISPLAY_NAME}. Set CIRCLE_ENV=production and use production Circle API keys.`,
      );
    }

    const created = await c.createUserPinWithWallets({
      userToken: data.userToken,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockchains: [CHAIN as any],
      accountType: "SCA",
    });
    return { challengeId: created.data?.challengeId ?? null, address: null as string | null };
  });

/** Read back the user's first wallet address and ID. */
export const listUserWallets = createServerFn({ method: "POST" })
  .validator((d: { userToken: string }) => d)
  .handler(async ({ data }) => {
    const res = await client().listWallets({ userToken: data.userToken });
    const w = pickWalletOnActiveChain(res.data?.wallets ?? []);
    return { id: w?.id ?? null, address: w?.address ?? null, blockchain: w?.blockchain ?? null };
  });

export const createWithdrawalTransaction = createServerFn({ method: "POST" })
  .validator((d: { userToken: string; recipientAddress: string; amount: number }) => d)
  .handler(async ({ data }) => {
    const c = client();

    // Fetch user wallets to find the walletId internally
    const walletsRes = await c.listWallets({ userToken: data.userToken });
    const selected = pickWalletOnActiveChain(walletsRes.data?.wallets ?? []);
    const walletId = selected?.id ?? walletsRes.data?.wallets?.[0]?.id;
    if (!walletId) {
      throw new Error("Could not locate your Circle wallet ID on the server.");
    }
    if (!selected?.id) {
      throw new Error(
        `No ${CHAIN_DISPLAY_NAME} Circle wallet found. Sign out and sign in again to create an Arc Mainnet wallet.`,
      );
    }

    // 1. Fetch user's token balances to find the dynamic USDC tokenId registered by Circle
    let tokenId = "";
    try {
      const balancesRes = await c.getWalletTokenBalance({
        walletId,
        userToken: data.userToken,
      });
      const tokenBalances = balancesRes.data?.tokenBalances ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usdcToken = tokenBalances.find((tb: any) => tb.token?.symbol?.toUpperCase() === "USDC");
      if (usdcToken?.token?.id) {
        tokenId = usdcToken.token.id;
      }
    } catch (e) {
      console.warn(
        "[createWithdrawalTransaction] failed to fetch balances, using fallback address:",
        e,
      );
    }

    const txParams: CreateTransactionInput = {
      userToken: data.userToken,
      idempotencyKey: crypto.randomUUID(),
      walletId,
      amounts: [String(data.amount)],
      destinationAddress: data.recipientAddress,
      fee: {
        type: "level",
        config: {
          feeLevel: "LOW",
        },
      },
    };

    if (tokenId) {
      txParams.tokenId = tokenId;
    } else {
      // Fallback: pass tokenAddress and blockchain
      const blockchainParam = CHAIN as NonNullable<CreateTransactionInput["blockchain"]>;
      txParams.tokenAddress = USDC_ADDRESS;
      txParams.blockchain = blockchainParam;
    }

    const res = await c.createTransaction(txParams);
    return { challengeId: res.data?.challengeId ?? null };
  });

export const waitForFundingTransaction = createServerFn({ method: "POST" })
  .validator(
    (d: {
      userToken: string;
      challengeId: string;
      expectedDestination: string;
      expectedAmount: number;
      minimumDestinationBalance?: number;
      timeoutMs?: number;
    }) => d,
  )
  .handler(async ({ data }) => {
    const c = client();
    const publicClient = createPublicClient({
      chain: activeChain,
      transport: http(ARC_RPC_URL),
    });
    const timeoutMs = Math.min(Math.max(data.timeoutMs ?? 120_000, 15_000), 300_000);
    const deadline = Date.now() + timeoutMs;
    const expectedDestination = data.expectedDestination.toLowerCase();
    const minimumDestinationBalance =
      data.minimumDestinationBalance != null
        ? parseUnits(data.minimumDestinationBalance.toFixed(6), USDC_DECIMALS)
        : null;
    let transactionId: string | null = null;
    let lastChallengeStatus = "PENDING";
    let lastTransactionState = "INITIATED";

    while (Date.now() < deadline) {
      const challengeRes = await c.getUserChallenge({
        userToken: data.userToken,
        challengeId: data.challengeId,
      });
      const challenge = challengeRes.data?.challenge;

      if (!challenge) {
        throw new Error("Could not load your Circle payment challenge.");
      }

      lastChallengeStatus = challenge.status;
      transactionId = challenge.correlationIds?.[0] ?? transactionId;

      if (challenge.status === "FAILED" || challenge.status === "EXPIRED") {
        throw new Error(
          challenge.errorMessage ||
            `Circle payment authorization ${challenge.status.toLowerCase()}.`,
        );
      }

      if (challenge.status === "COMPLETE" && transactionId) {
        break;
      }

      await sleep(2_000);
    }

    if (!transactionId) {
      throw new Error(
        `Circle did not return a transaction ID. Challenge status: ${lastChallengeStatus.toLowerCase()}.`,
      );
    }

    while (Date.now() < deadline) {
      const txRes = await c.getTransaction({
        userToken: data.userToken,
        id: transactionId,
      });
      const tx = txRes.data?.transaction;

      if (!tx) {
        throw new Error("Could not load the Circle funding transaction.");
      }

      lastTransactionState = tx.state;

      if (tx.destinationAddress && tx.destinationAddress.toLowerCase() !== expectedDestination) {
        throw new Error(
          `Circle routed funds to ${tx.destinationAddress}, not the escrow contract.`,
        );
      }

      const amount = Number(tx.amounts?.[0] ?? "0");
      if (
        Number.isFinite(amount) &&
        amount > 0 &&
        Math.abs(amount - data.expectedAmount) > 0.000001
      ) {
        throw new Error(
          `Circle authorized ${amount} USDC, but JuriXAI expected ${data.expectedAmount} USDC.`,
        );
      }

      if (tx.state === "FAILED" || tx.state === "DENIED" || tx.state === "CANCELLED") {
        throw new Error(
          tx.errorDetails || tx.errorReason || `Circle transaction ${tx.state.toLowerCase()}.`,
        );
      }

      if (tx.state === "CONFIRMED" || tx.state === "COMPLETE") {
        if (tx.txHash) {
          await publicClient.waitForTransactionReceipt({
            hash: tx.txHash as `0x${string}`,
            timeout: 30_000,
          });
        }

        if (minimumDestinationBalance !== null) {
          while (Date.now() < deadline) {
            const destinationBalance = (await publicClient.readContract({
              address: USDC_ADDRESS,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [data.expectedDestination as `0x${string}`],
            })) as bigint;

            if (destinationBalance >= minimumDestinationBalance) {
              break;
            }

            await sleep(2_000);
          }

          const finalDestinationBalance = (await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [data.expectedDestination as `0x${string}`],
          })) as bigint;

          if (finalDestinationBalance < minimumDestinationBalance) {
            throw new Error(
              `Circle reported the payment complete, but ${data.expectedDestination} never received the required USDC on-chain.`,
            );
          }
        }

        return {
          transactionId,
          txHash: tx.txHash ?? null,
          state: tx.state,
        };
      }

      await sleep(3_000);
    }

    throw new Error(
      `Circle payment is still ${lastTransactionState.toLowerCase()}. Please wait for settlement and try again.`,
    );
  });
