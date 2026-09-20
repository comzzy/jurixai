/**
 * x402 integration for the JuriXAI Auditor pay-per-call API.
 *
 * Settles EIP-3009 `exact` USDC payments on Arc Mainnet (eip155:5042).
 * Verify + settle go through an Arc x402 facilitator (Arcus by default),
 * not the OKX X Layer facilitator.
 */
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { x402HTTPResourceServer } from "@okxweb3/x402-core/http";
import type {
  HTTPAdapter,
  HTTPRequestContext,
  HTTPResponseInstructions,
} from "@okxweb3/x402-core/http";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { resolveX402PaymentHeader } from "@/lib/x402/payment-header";
import { JURIX_X402_PAY_TO } from "@/lib/x402/payee";

export const ARC_X402_NETWORK = "eip155:5042" as const;
/** @deprecated Auditor payments settle on Arc Mainnet, not X Layer. */
export const XLAYER_NETWORK = ARC_X402_NETWORK;
export const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
export const ARC_USDC_EXTRA = {
  name: "USDC",
  version: "2",
  assetTransferMethod: "eip3009",
};
/** @deprecated Use ARC_USDC_ASSET. */
export const USDT0_ASSET = ARC_USDC_ASSET;
/** @deprecated Use ARC_USDC_EXTRA. */
export const USDT0_EXTRA = ARC_USDC_EXTRA;
export const JUDGE_PAYMENT_TIMEOUT_SECONDS = 300;
const FACILITATOR_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ARC_FACILITATOR_URL = "https://facilitator.arcusnetwork.io";

function facilitatorUrl(): string {
  return (process.env.JURIX_X402_FACILITATOR_URL ?? DEFAULT_ARC_FACILITATOR_URL).replace(/\/$/, "");
}

class ArcHttpFacilitatorClient {
  constructor(private readonly url: string) {}

  async getSupported() {
    const response = await fetch(`${this.url}/supported`);
    if (!response.ok) {
      throw new Error(`Arc facilitator /supported failed (${response.status})`);
    }
    return response.json();
  }

  async verify(paymentPayload: unknown, paymentRequirements: unknown) {
    const response = await fetch(`${this.url}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !("isValid" in data)) {
      throw new Error(`Arc facilitator /verify failed (${response.status})`);
    }
    return data;
  }

  async settle(paymentPayload: unknown, paymentRequirements: unknown) {
    const response = await fetch(`${this.url}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !("success" in data)) {
      throw new Error(`Arc facilitator /settle failed (${response.status})`);
    }
    return data;
  }
}

/** Per-agent pricing in USDC minimum units (6 decimals). */
export const AGENTS_PRICING: Record<string, bigint> = {
  "vex-01": 250000n, // 0.25 USDT (Engineering)
  "kael-02": 250000n, // 0.25 USDT (Product/UX)
  "oryn-03": 250000n, // 0.25 USDT (Innovation)
  "zera-04": 250000n, // 0.25 USDT (Completeness/Docs)
};
export const DEFAULT_AGENT_SLUGS = ["vex-01", "kael-02", "oryn-03", "zera-04"];

/** Declared so buyers can assemble params before signing a 402 challenge. */
export const JUDGE_OUTPUT_SCHEMA = {
  input: {
    type: "http",
    method: "POST",
    bodyType: "json",
    queryParams: {
      properties: {
        githubUrl: {
          type: "string",
          description: "Public GitHub repository URL. Example: https://github.com/octocat/Hello-World",
        },
        description: {
          type: "string",
          description:
            "Project description covering purpose and key features. Example: GitHub Hello World sample repository",
        },
        agents: {
          type: "string",
          description: "Optional comma-separated agent slugs: vex-01,kael-02,oryn-03,zera-04",
        },
      },
      required: ["githubUrl", "description"],
    },
    body: {
      properties: {
        githubUrl: {
          type: "string",
          description: "Public GitHub repository URL. Example: https://github.com/octocat/Hello-World",
        },
        description: {
          type: "string",
          description:
            "Project description covering purpose and key features. Example: GitHub Hello World sample repository",
        },
        agents: {
          type: "array",
          items: { type: "string", enum: DEFAULT_AGENT_SLUGS },
          description: "Optional agent slugs. Defaults to all four.",
        },
      },
      required: ["githubUrl", "description"],
    },
  },
} as const;

export interface JudgeRequestParams {
  agentSlugs: string[];
  repoCount: number;
}

async function withTimeout<Result>(
  promise: Promise<Result>,
  timeoutMs: number,
  message: string,
): Promise<Result> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function buildPaymentRequiredResponse(params: {
  resourceUrl: string;
  description: string;
  amount: bigint;
  payTo: string;
  errorMessage?: string;
}): HTTPResponseInstructions {
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: params.resourceUrl,
      description: params.description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: ARC_X402_NETWORK,
        asset: ARC_USDC_ASSET,
        amount: params.amount.toString(),
        payTo: params.payTo,
        maxTimeoutSeconds: JUDGE_PAYMENT_TIMEOUT_SECONDS,
        symbol: "USDC",
        decimals: 6,
        extra: { ...ARC_USDC_EXTRA },
      },
    ],
    extensions: { outputSchema: JUDGE_OUTPUT_SCHEMA },
    error: params.errorMessage,
  };

  return {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
    body: {
      error: params.errorMessage ?? "Payment required",
    },
  };
}

/** Total price in USDC minimum units for the requested agents × repositories. */
export function computeExpectedAmount({ agentSlugs, repoCount }: JudgeRequestParams): bigint {
  const feePerRepo = agentSlugs.reduce((sum, slug) => sum + (AGENTS_PRICING[slug] || 0n), 0n);
  return feePerRepo * BigInt(Math.max(repoCount, 1));
}

/** Minimal HTTPAdapter over a Fetch API Request with a pre-parsed body. */
function createRequestAdapter(request: Request, parsedBody: unknown): HTTPAdapter {
  const url = new URL(request.url);
  const paymentSignature = resolveX402PaymentHeader(request.headers);
  return {
    getHeader: (name) =>
      name.toLowerCase() === "payment-signature"
        ? paymentSignature
        : (request.headers.get(name) ?? undefined),
    getMethod: () => request.method.toUpperCase(),
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
    getQueryParam: (name) => url.searchParams.get(name) ?? undefined,
    getBody: () => parsedBody,
  };
}

let httpServerPromise: Promise<x402HTTPResourceServer | null> | null = null;

function buildRouteConfig(params: JudgeRequestParams) {
  const amount = computeExpectedAmount(params).toString();
  const accepts = {
    scheme: "exact",
    network: ARC_X402_NETWORK,
    payTo: JURIX_X402_PAY_TO,
    price: {
      amount,
      asset: ARC_USDC_ASSET,
      symbol: "USDC",
      decimals: 6,
      extra: { ...ARC_USDC_EXTRA },
    },
    maxTimeoutSeconds: JUDGE_PAYMENT_TIMEOUT_SECONDS,
    symbol: "USDT",
    decimals: 6,
  };
  const description = `JuriXAI Auditor: Modular multi-agent repository quality audit service (Agents: ${params.agentSlugs.join(", ")}).`;
  return {
    accepts,
    description,
    mimeType: "application/json",
    extensions: { outputSchema: JUDGE_OUTPUT_SCHEMA },
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        ok: false,
        error:
          "Payment required. Retry with a standard x402 PAYMENT-SIGNATURE header, or pass a txHash of a direct Arc Mainnet USDC transfer, or set sandbox=true for a free preview.",
        x402Version: 2,
        required: {
          githubUrl: "Public GitHub repository URL",
          description: "Project description covering purpose and key features",
        },
        outputSchema: JUDGE_OUTPUT_SCHEMA,
      },
    }),
  };
}

/**
 * Lazily create (once) the x402 resource server connected to the Arc facilitator.
 * Returns null when the facilitator is unreachable so the caller can still issue
 * an Arc 402 challenge and accept a direct USDC txHash.
 */
async function getBaseServer(): Promise<x402ResourceServer | null> {
  const facilitatorClient = new ArcHttpFacilitatorClient(facilitatorUrl());
  const server = new x402ResourceServer(facilitatorClient).register(
    ARC_X402_NETWORK,
    new ExactEvmScheme(),
  );

  let timeoutId: NodeJS.Timeout | undefined;
  const initPromise = server.initialize();
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Timeout initializing Arc x402 facilitator (3s limit reached)")),
      3000,
    );
  });

  try {
    await Promise.race([initPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
  return server;
}

async function getCachedBaseServer(): Promise<x402ResourceServer | null> {
  if (!httpServerPromise) {
    // Cache failures for the lifetime of this (serverless) instance so a
    // misconfigured facilitator key doesn't add a doomed round-trip per request.
    httpServerPromise = getBaseServer().catch((err) => {
      console.error("[x402] Arc facilitator initialization failed:", err);
      return null;
    }) as Promise<x402HTTPResourceServer | null>;
  }
  return httpServerPromise as unknown as Promise<x402ResourceServer | null>;
}

export type OkxPaymentResult =
  | { type: "unavailable" }
  | { type: "payment-error"; response: HTTPResponseInstructions }
  | {
      type: "payment-verified";
      /** Call after the resource has been produced to settle on Arc Mainnet. */
      settle: () => Promise<
        | { success: true; headers: Record<string, string>; transaction?: string }
        | { success: false; response: HTTPResponseInstructions }
      >;
    };

/**
 * Run the standard x402 flow for a judge request.
 *
 * - No PAYMENT-SIGNATURE header → returns the standard 402 challenge
 *   (PAYMENT-REQUIRED header) for Arc Mainnet USDC.
 * - Valid PAYMENT-SIGNATURE → verified with the Arc facilitator; returns a
 *   settle() callback to execute settlement on Arc after the audit succeeds.
 * - Facilitator down → { type: "unavailable" } so the caller can fall back
 *   to the legacy Arc USDC txHash challenge.
 */
export async function processOkxPayment(
  request: Request,
  parsedBody: unknown,
  params: JudgeRequestParams,
): Promise<OkxPaymentResult> {
  const baseServer = await getCachedBaseServer();
  if (!baseServer) return { type: "unavailable" };

  const routeConfig = buildRouteConfig(params);
  const httpServer = new x402HTTPResourceServer(baseServer, {
    "GET /api/judge": routeConfig,
    "POST /api/judge": routeConfig,
  });

  const adapter = createRequestAdapter(request, parsedBody);
  const paymentHeader = adapter.getHeader("payment-signature");

  const context: HTTPRequestContext = {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader,
  };

  let result: Awaited<ReturnType<typeof httpServer.processHTTPRequest>>;
  try {
    result = await withTimeout(
      httpServer.processHTTPRequest(context),
      FACILITATOR_REQUEST_TIMEOUT_MS,
      "Arc payment verification timed out",
    );
  } catch (error) {
    console.error("[x402] Payment verification request failed:", error);
    return {
      type: "payment-error",
      response: {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Retry-After": "5",
        },
        body: {
          ok: false,
          error:
            "Payment verification service is temporarily unavailable. Retry with the same payment authorization.",
          retryable: true,
        },
      },
    };
  }

  if (result.type === "payment-error") {
    return { type: "payment-error", response: result.response };
  }

  if (result.type === "payment-verified") {
    const { paymentPayload, paymentRequirements, declaredExtensions } = result;
    return {
      type: "payment-verified",
      settle: async () => {
        let settleResult: Awaited<ReturnType<typeof httpServer.processSettlement>>;
        try {
          settleResult = await withTimeout(
            httpServer.processSettlement(paymentPayload, paymentRequirements, declaredExtensions, {
              request: context,
            }),
            FACILITATOR_REQUEST_TIMEOUT_MS,
            "Arc payment settlement timed out",
          );
        } catch (error) {
          console.error("[x402] Payment settlement request failed:", error);
          return {
            success: false,
            response: {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "Retry-After": "5",
              },
              body: {
                ok: false,
                error:
                  "Payment settlement service is temporarily unavailable. Retry with the same payment authorization.",
                retryable: true,
              },
            },
          };
        }
        if (settleResult.success) {
          return {
            success: true,
            headers: settleResult.headers,
            transaction: (settleResult as { transaction?: string }).transaction,
          };
        }
        return { success: false, response: settleResult.response };
      },
    };
  }

  // "no-payment-required" should not happen for our protected routes, but if the
  // route matcher misses, treat as unavailable so the legacy flow still guards.
  return { type: "unavailable" };
}

/** Convert SDK HTTPResponseInstructions into a Fetch API Response. */
export function instructionsToResponse(instructions: HTTPResponseInstructions): Response {
  const headers = new Headers(instructions.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");

  if (instructions.isHtml) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(String(instructions.body ?? ""), {
      status: instructions.status,
      headers,
    });
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const body =
    typeof instructions.body === "string"
      ? instructions.body
      : JSON.stringify(instructions.body ?? {});
  return new Response(body, { status: instructions.status, headers });
}
