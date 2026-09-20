import { createPublicClient, formatUnits, http } from "viem";
import { activeChain, ARC_RPC_URL } from "./chain";

const ARC_NATIVE_DECIMALS = 18;

/** Native USDC balance on the active Arc network (18-decimal eth_getBalance view). */
export async function readArcUsdcBalance(address: string): Promise<number> {
  const client = createPublicClient({ chain: activeChain, transport: http(ARC_RPC_URL) });
  const raw = await client.getBalance({ address: address as `0x${string}` });
  return Number(formatUnits(raw, ARC_NATIVE_DECIMALS));
}
