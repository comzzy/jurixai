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

function pickWalletOnActiveChain<T extends { blockchain?: string | null; address?: string | null; id?: string | null }>(
  wallets: T[],
): T | undefined {
  const wanted = CHAIN.toUpperCase();
  return (
    wallets.find((w) => (w.blockchain ?? "").toUpperCase() === wanted) ??
    (wanted === "ARC" ? wallets.find((w) => (w.blockchain ?? "").toUpperCase() === "ARC-MAINNET") : undefined)
  );
}

function client() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not set on the server (add it in Vercel).");
  }
  const live =
    apiKey.startsWith("LIVE_API_KEY") ||
    (process.env.CIRCLE_ENV ?? "").trim().toLowerCase() === "production";
  return initiateUserControlledWalletsClient({
    apiKey,
    baseUrl: live ? "https://api.circle.com" : "https://api-sandbox.circle.com",
  });
}

type CreateTransactionInput = Parameters<ReturnType<typeof client>["createTransaction"]>[0];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function circleKeyKind(): "LIVE" | "TEST" | "MISSING" | "OTHER" {
  const key = process.env.CIRCLE_API_KEY?.trim() ?? "";
  if (!key) return "MISSING";
  if (key.startsWith("LIVE_API_KEY")) return "LIVE";
  if (key.startsWith("TEST_API_KEY")) return "TEST";
  return "OTHER";
}

/** Report whether the server has the minimum config required for email login. */
export const emailLoginStatus = createServerFn({ method: "GET" }).handler(async () => ({
  configured: circleKeyKind() === "LIVE",
  apiKeyConfigured: circleKeyKind() !== "MISSING",
  apiKeyKind: circleKeyKind(),
  circleEnv: (process.env.CIRCLE_ENV ?? "").trim() || "unset",
  chain: CHAIN,
}));

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
    try {
      const res = await client().createDeviceTokenForEmailLogin({
        deviceId: data.deviceId,
        email: data.email,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = res.data as any;
      return {
        deviceToken: d.deviceToken as string,
        deviceEncryptionKey: d.deviceEncryptionKey as string,
        otpToken: d.otpToken as string | undefined,
      };
    } catch (err) {
      const anyErr = err as { response?: { data?: { message?: string; code?: number } }; message?: string };
      const circleMessage = anyErr.response?.data?.message || anyErr.message || "Circle email login failed";
      const code = anyErr.response?.data?.code;
      throw new Error(code ? `Circle login failed (${code}): ${circleMessage}` : `Circle login failed: ${circleMessage}`);
    }
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
