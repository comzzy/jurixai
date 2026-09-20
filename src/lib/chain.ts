/**
 * Chain configuration and USDC helpers.
 *
 * Production is Arc Mainnet (Circle code `ARC`, chain 5042).
 * Active network is VITE_CIRCLE_CHAIN (client) / CIRCLE_CHAIN (server).
 *
 * Circle chain codes: ARC, ARC-TESTNET, MATIC-AMOY, XLAYER-MAINNET.
 * Aliases: ARC-MAINNET -> ARC, polygonAmoy -> MATIC-AMOY, xlayerMainnet -> XLAYER-MAINNET.
 */
import { createPublicClient, http, erc20Abi, formatUnits, defineChain } from "viem";

const ENV =
  (typeof process !== "undefined" ? process.env : null) ??
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  {};

const ARC_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const ARC_MAINNET_ESCROW = "0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5";
const ARC_TESTNET_ESCROW = "0xb48e0b50d44b1609004cbc41c311d478a4900ce3";
const XLAYER_ESCROW = "0xd5294c32b2d4b29f141afd97346820af0235191f";

/** Circle User-Controlled Wallets blockchain identifier. */
export type CircleChainCode = "ARC-TESTNET" | "ARC" | "MATIC-AMOY" | "XLAYER-MAINNET";

export function normalizeCircleChain(raw: string | undefined | null): CircleChainCode {
  const v = (raw ?? "").trim();
  const lower = v.toLowerCase();
  if (!lower) return "ARC";
  if (lower === "arc" || lower === "arc-mainnet" || lower === "arcmainnet") return "ARC";
  if (lower === "arc-testnet" || lower === "arctestnet") return "ARC-TESTNET";
  if (lower === "matic-amoy" || lower === "polygonamoy") return "MATIC-AMOY";
  if (lower === "xlayer-mainnet" || lower === "xlayermainnet") return "XLAYER-MAINNET";
  return "ARC";
}

function isProductionBuild(): boolean {
  if (ENV.PROD === true || ENV.MODE === "production") return true;
  return typeof process !== "undefined" && process.env.VERCEL_ENV === "production";
}

function envChainRaw(): string | undefined {
  const serverChain = typeof process !== "undefined" ? process.env.CIRCLE_CHAIN : undefined;
  return serverChain || ENV.VITE_CIRCLE_CHAIN || ENV.CIRCLE_CHAIN;
}

function chainFromEnv(): CircleChainCode {
  const normalized = normalizeCircleChain(envChainRaw());
  // Leftover Vercel ARC-TESTNET must not keep production on faucet USDC.
  if (isProductionBuild() && normalized === "ARC-TESTNET") return "ARC";
  return normalized;
}

export let CHAIN_NAME: CircleChainCode = chainFromEnv();

// Browser override: ?chain=ARC or localStorage jurixai_active_chain
if (typeof window !== "undefined") {
  const urlParams = new URLSearchParams(window.location.search);
  const chainParam = urlParams.get("chain");
  if (chainParam) {
    localStorage.setItem("jurixai_active_chain", chainParam);
    CHAIN_NAME = normalizeCircleChain(chainParam);
  } else {
    const storedChain = localStorage.getItem("jurixai_active_chain");
    if (storedChain) {
      const stored = normalizeCircleChain(storedChain);
      if (stored !== "ARC-TESTNET") {
        CHAIN_NAME = stored;
      }
    }
  }
}

type ChainPreset = {
  displayName: string;
  explorerName: string;
  rpcUrl: string;
  explorerUrl: string;
  chainId: number;
  usdcAddress: `0x${string}`;
  nativeName: string;
  nativeSymbol: string;
  tokenSymbol: string;
  isTestnet: boolean;
  escrowAddress: string;
};

const PRESETS: Record<CircleChainCode, ChainPreset> = {
  "ARC-TESTNET": {
    displayName: "Arc Testnet",
    explorerName: "Arcscan",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
    chainId: 5042002,
    usdcAddress: ARC_USDC,
    nativeName: "USDC",
    nativeSymbol: "USDC",
    tokenSymbol: "USDC",
    isTestnet: true,
    escrowAddress: ARC_TESTNET_ESCROW,
  },
  ARC: {
    displayName: "Arc Mainnet",
    explorerName: "Arc Explorer",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
    chainId: 5042,
    usdcAddress: ARC_USDC,
    nativeName: "USDC",
    nativeSymbol: "USDC",
    tokenSymbol: "USDC",
    isTestnet: false,
    escrowAddress: ARC_MAINNET_ESCROW,
  },
  "MATIC-AMOY": {
    displayName: "Polygon Amoy",
    explorerName: "Polygonscan",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    explorerUrl: "https://amoy.polygonscan.com",
    chainId: 80002,
    usdcAddress: "0x41e94E0f9B5447f3963e45cf585d5D36e372559a",
    nativeName: "POL",
    nativeSymbol: "POL",
    tokenSymbol: "USDC",
    isTestnet: true,
    escrowAddress: ARC_TESTNET_ESCROW,
  },
  "XLAYER-MAINNET": {
    displayName: "X Layer Mainnet",
    explorerName: "OKX Explorer",
    rpcUrl: "https://rpc.xlayer.tech",
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
    chainId: 196,
    usdcAddress: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nativeName: "OKB",
    nativeSymbol: "OKB",
    tokenSymbol: "USDT",
    isTestnet: false,
    escrowAddress: XLAYER_ESCROW,
  },
};

const preset = PRESETS[CHAIN_NAME];

const rpcUrl =
  CHAIN_NAME === "XLAYER-MAINNET"
    ? ENV.VITE_XLAYER_RPC_URL || preset.rpcUrl
    : CHAIN_NAME === "MATIC-AMOY"
      ? preset.rpcUrl
      : ENV.VITE_ARC_RPC_URL || preset.rpcUrl;

const explorerUrl =
  CHAIN_NAME === "XLAYER-MAINNET"
    ? ENV.VITE_XLAYER_EXPLORER || preset.explorerUrl
    : CHAIN_NAME === "MATIC-AMOY"
      ? preset.explorerUrl
      : ENV.VITE_ARC_EXPLORER || preset.explorerUrl;

const chainId =
  CHAIN_NAME === "ARC-TESTNET" || CHAIN_NAME === "ARC"
    ? Number(ENV.VITE_ARC_CHAIN_ID || String(preset.chainId))
    : preset.chainId;

const usdcAddress = (
  CHAIN_NAME === "XLAYER-MAINNET"
    ? ENV.VITE_XLAYER_USDT_ADDRESS || preset.usdcAddress
    : ENV.VITE_USDC_ADDRESS || preset.usdcAddress
) as `0x${string}`;

export const CIRCLE_CHAIN_CODE: CircleChainCode = CHAIN_NAME;
export const CHAIN_DISPLAY_NAME = preset.displayName;
export const TOKEN_SYMBOL = preset.tokenSymbol;
export const IS_TESTNET = preset.isTestnet;
export const IS_ARC_MAINNET = CHAIN_NAME === "ARC";
export const IS_ARC = CHAIN_NAME === "ARC" || CHAIN_NAME === "ARC-TESTNET";

export const ARC_RPC_URL = rpcUrl;
export const ARC_EXPLORER = explorerUrl;
export const ARC_CHAIN_ID = chainId;
export const USDC_ADDRESS = usdcAddress;
export const USDC_DECIMALS = 6;

export const activeChain = defineChain({
  id: ARC_CHAIN_ID,
  name: CHAIN_DISPLAY_NAME,
  nativeCurrency: {
    name: preset.nativeName,
    symbol: preset.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: preset.explorerName,
      url: ARC_EXPLORER,
    },
  },
  testnet: IS_TESTNET,
});

export function explorerAddr(addr: string): string {
  return `${ARC_EXPLORER}/address/${addr}`;
}

export function explorerTx(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

/** Read a wallet's USDC (or USDT on X Layer) balance on the active chain. */
export async function readUsdcBalance(address: string): Promise<number> {
  const client = createPublicClient({ chain: activeChain, transport: http(ARC_RPC_URL) });
  const raw = (await client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  })) as bigint;
  return Number(formatUnits(raw, USDC_DECIMALS));
}

export const ESCROW_CONTRACT_ADDRESS =
  ENV.VITE_ESCROW_CONTRACT_ADDRESS || preset.escrowAddress;

export function requireEscrowAddress(): `0x${string}` {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error(
      `No escrow contract configured for ${CHAIN_DISPLAY_NAME}. Deploy JuriXEscrow, then set VITE_ESCROW_CONTRACT_ADDRESS.`,
    );
  }
  return ESCROW_CONTRACT_ADDRESS as `0x${string}`;
}

export const escrowAbi = [
  {
    inputs: [{ internalType: "string", name: "hackathonId", type: "string" }],
    name: "cancelAndRefund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "hackathonId", type: "string" },
      { internalType: "address[]", name: "winners", type: "address[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "disbursePrizes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "", type: "string" }],
    name: "hackathons",
    outputs: [
      { internalType: "address", name: "hoster", type: "address" },
      { internalType: "uint256", name: "prizePool", type: "uint256" },
      { internalType: "uint256", name: "platformFee", type: "uint256" },
      { internalType: "bool", name: "disbursed", type: "bool" },
      { internalType: "bool", name: "exists", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "hackathonId", type: "string" },
      { internalType: "address", name: "hoster", type: "address" },
      { internalType: "uint256", name: "prizePool", type: "uint256" },
      { internalType: "uint256", name: "platformFee", type: "uint256" },
    ],
    name: "registerHackathon",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newFeeCollector", type: "address" }],
    name: "setFeeCollector",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOperator", type: "address" }],
    name: "transferOperator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
