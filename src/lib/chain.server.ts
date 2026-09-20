/**
 * Server-only chain actions using the administrator's operator private key.
 * Strictly executed on the server to prevent private key leakage.
 */
import { createPublicClient, http, erc20Abi, createWalletClient, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  activeChain,
  ARC_RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  escrowAbi,
  requireEscrowAddress,
} from "./chain";

/** Send USDC on the active chain using the operator's private key. */
export async function sendUsdc(toAddress: string, amountUsdc: number): Promise<string> {
  const privateKey = process.env.JURIX_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing JURIX_OPERATOR_PRIVATE_KEY on the server.");
  }

  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const amountBigInt = parseUnits(amountUsdc.toFixed(6), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, amountBigInt],
  });

  await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  return hash;
}

/** Derive the public EVM address of the server's operator key. */
export function getOperatorAddress(): string {
  const privateKey = process.env.JURIX_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing JURIX_OPERATOR_PRIVATE_KEY on the server.");
  }
  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  return account.address;
}



/** Register a hackathon on the escrow smart contract using the operator key. */
export async function registerHackathonOnChain(
  hackathonId: string,
  hoster: string,
  prizePool: number,
  platformFee: number,
): Promise<string> {
  const privateKey = process.env.JURIX_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing JURIX_OPERATOR_PRIVATE_KEY on the server.");
  }

  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  // Convert amounts to BigInt with 6 decimals (USDC standard)
  const prizePoolBigInt = parseUnits(prizePool.toFixed(6), USDC_DECIMALS);
  const platformFeeBigInt = parseUnits(platformFee.toFixed(6), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: requireEscrowAddress(),
    abi: escrowAbi,
    functionName: "registerHackathon",
    args: [hackathonId, hoster as `0x${string}`, prizePoolBigInt, platformFeeBigInt],
  });

  await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  return hash;
}

async function getOnChainId(publicClient: any, hackathonId: string): Promise<string> {
  if (hackathonId === "kane-hackathon") {
    try {
      const details = await publicClient.readContract({
        address: requireEscrowAddress(),
        abi: escrowAbi,
        functionName: "hackathons",
        args: [hackathonId],
      }) as any;
      const exists = details[4];
      if (!exists) {
        const emptyDetails = await publicClient.readContract({
          address: requireEscrowAddress(),
          abi: escrowAbi,
          functionName: "hackathons",
          args: [""],
        }) as any;
        const emptyExists = emptyDetails[4];
        if (emptyExists) {
          console.log(`[escrow] kane-hackathon not found on-chain, but empty string ID exists. Mapping to ""`);
          return "";
        }
      }
    } catch (e) {
      console.warn("[escrow] Failed to query on-chain hackathon existence:", e);
    }
  }
  return hackathonId;
}

/** Disburse prizes from the escrow smart contract using the operator key. */
export async function disbursePrizesOnChain(
  hackathonId: string,
  winners: string[],
  amounts: number[],
): Promise<string> {
  const privateKey = process.env.JURIX_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing JURIX_OPERATOR_PRIVATE_KEY on the server.");
  }

  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const onChainId = await getOnChainId(publicClient, hackathonId);
  const amountsBigInt = amounts.map((a) => parseUnits(a.toFixed(6), USDC_DECIMALS));

  const hash = await walletClient.writeContract({
    address: requireEscrowAddress(),
    abi: escrowAbi,
    functionName: "disbursePrizes",
    args: [onChainId, winners as `0x${string}`[], amountsBigInt],
  });

  await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  return hash;
}

/** Cancel a hackathon and refund the prize pool to the hoster on the escrow smart contract using the operator key. */
export async function cancelAndRefundOnChain(hackathonId: string): Promise<string> {
  const privateKey = process.env.JURIX_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing JURIX_OPERATOR_PRIVATE_KEY on the server.");
  }

  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: activeChain,
    transport: http(ARC_RPC_URL),
  });

  const onChainId = await getOnChainId(publicClient, hackathonId);

  const hash = await walletClient.writeContract({
    address: requireEscrowAddress(),
    abi: escrowAbi,
    functionName: "cancelAndRefund",
    args: [onChainId],
  });

  await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  return hash;
}


