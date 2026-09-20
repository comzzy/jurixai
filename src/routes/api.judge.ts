import { createFileRoute } from "@tanstack/react-router";
import { evaluateSubmissionWithModel, parseGitHubRepo } from "@/lib/jurix/judge-model.server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createPublicClient, http, decodeFunctionData } from "viem";
import { ARC_USDC_ASSET } from "@/lib/x402/okx.server";
import {
  buildPaymentRequiredResponse,
  processOkxPayment,
  instructionsToResponse,
  type OkxPaymentResult,
} from "@/lib/x402/okx.server";
import { resolveX402PaymentHeader } from "@/lib/x402/payment-header";
import { JURIX_X402_PAY_TO } from "@/lib/x402/payee";
import {
  createX402PaymentKey,
  createX402RequestFingerprint,
  parseX402ReplayRecord,
  serializeX402ReplayRecord,
} from "@/lib/x402/replay-cache";
import type {
  JudgeAgent,
  JudgingCriterion,
  HackathonSummary,
  SubmissionSummary,
  WorkspaceSnapshot,
} from "@/lib/jurix/types";

// Standard ERC20 transfer ABI for decoding
const transferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Define default criteria and details for the pay-per-call service
const AGENT_CRITERIA_MAP = {
  "vex-01": {
    name: "Code Quality & Implementation",
    description:
      "Does the code run correctly? Is it clean, well-structured, secure, and maintainable?",
  },
  "kael-02": {
    name: "Product Design & UX",
    description: "Is the design user-friendly? Does the product solve a real problem effectively?",
  },
  "oryn-03": {
    name: "Innovation & Originality",
    description: "How creative is the project? Is the solution new and ambitious?",
  },
  "zera-04": {
    name: "Completeness & Execution",
    description:
      "Is the codebase polished? Are there good instructions, docs, and clean deployment files?",
  },
};

function extractAllGitHubUrls(obj: unknown): string[] {
  const urls: string[] = [];
  const githubUrlRegex = /https?:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/gi;

  function traverse(item: unknown) {
    if (!item) return;
    if (typeof item === "string") {
      const matches = item.match(githubUrlRegex);
      if (matches) {
        urls.push(...matches);
      }
    } else if (Array.isArray(item)) {
      item.forEach(traverse);
    } else if (typeof item === "object" && item !== null) {
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          traverse((item as Record<string, unknown>)[key]);
        }
      }
    }
  }

  traverse(obj);
  return [...new Set(urls)];
}

function normalizeGithubUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\/$/, "") // remove trailing slash
    .replace(/\.git$/, ""); // remove .git suffix
}

function generateTextReport(
  batchResults: Array<{
    githubUrl: string;
    evaluations: Array<{
      agent: string;
      role: string;
      score: number | null;
      confidence: number;
      rationale: string;
      evidence: string[];
      flags: string[];
      locked?: boolean;
    }>;
    averageScore: number | null;
    partialScore: number | null;
    dimensionsEvaluated: number;
    totalDimensions: number;
  }>,
  sandbox: boolean,
  txHash: string,
): string {
  let content = "";
  content += `======================================================================\n`;
  content += `                     JURIXAI AUDIT VERDICT REPORT                     \n`;
  content += `======================================================================\n`;
  content += `Execution Mode: ${sandbox ? "Sandbox (Free)" : "Live (Paid)"}\n`;
  content += `Transaction Hash: ${txHash || "N/A"}\n`;
  content += `Total Repositories: ${batchResults.length}\n`;
  content += `======================================================================\n\n`;

  batchResults.forEach((repo, idx) => {
    content += `----------------------------------------------------------------------\n`;
    content += `📂 [Repository ${idx + 1}/${batchResults.length}] ${repo.githubUrl}\n`;
    if (repo.averageScore !== null) {
      content += `Average Score: ${repo.averageScore} / 10 (based on all ${repo.totalDimensions} dimensions)\n`;
    } else if (repo.partialScore !== null) {
      content += `Partial Score: ${repo.partialScore} / 10 (${repo.dimensionsEvaluated} of ${repo.totalDimensions} dimensions evaluated; no average issued)\n`;
    } else {
      content += `Average Score: Not available (0 of ${repo.totalDimensions} dimensions evaluated)\n`;
    }
    content += `----------------------------------------------------------------------\n\n`;

    repo.evaluations.forEach((ev) => {
      content += `🤖 Agent: ${ev.agent} (${ev.role})\n`;
      content += `   Score: ${ev.score !== null ? ev.score + " / 10" : "Locked (Sandbox Mode)"}\n`;
      content += `   Confidence: ${(ev.confidence * 100).toFixed(0)}%\n`;
      content += `   Rationale: ${ev.rationale}\n`;

      if (ev.evidence && ev.evidence.length > 0) {
        content += `   Evidence:\n`;
        ev.evidence.forEach((item) => {
          content += `     - ${item}\n`;
        });
      }

      if (ev.flags && ev.flags.length > 0) {
        content += `   Flags:\n`;
        ev.flags.forEach((flag) => {
          content += `     - ${flag}\n`;
        });
      }
      content += `\n`;
    });
  });
  content += `======================================================================\n`;
  return content;
}

const VALID_AGENT_SLUGS = ["vex-01", "kael-02", "oryn-03", "zera-04"] as const;
const DEFAULT_GITHUB_URL = "https://github.com/octocat/Hello-World";
const DEFAULT_DESCRIPTION = "GitHub Hello World sample repository";
const PAID_AUDIT_MODEL_TIMEOUT_MS = 12_000;

const FALLBACK_JUDGE_AGENTS: JudgeAgent[] = [
  {
    id: "vex-01",
    slug: "vex-01",
    name: "Vex",
    short_code: "VX",
    role: "Engineering",
    focus_area: "Code quality and implementation",
    status: "idle",
    color_hex: "#7C5CFF",
    weight_percent: 25,
    system_prompt: null,
    scoring_notes: null,
    wallet_address: null,
    created_at: new Date(0).toISOString(),
  },
  {
    id: "kael-02",
    slug: "kael-02",
    name: "Kael",
    short_code: "KL",
    role: "Product / UX",
    focus_area: "Product design and user experience",
    status: "idle",
    color_hex: "#22D3EE",
    weight_percent: 25,
    system_prompt: null,
    scoring_notes: null,
    wallet_address: null,
    created_at: new Date(0).toISOString(),
  },
  {
    id: "oryn-03",
    slug: "oryn-03",
    name: "Oryn",
    short_code: "OR",
    role: "Innovation",
    focus_area: "Originality and ambition",
    status: "idle",
    color_hex: "#F59E0B",
    weight_percent: 25,
    system_prompt: null,
    scoring_notes: null,
    wallet_address: null,
    created_at: new Date(0).toISOString(),
  },
  {
    id: "zera-04",
    slug: "zera-04",
    name: "Zera",
    short_code: "ZR",
    role: "Completeness",
    focus_area: "Docs, polish, and delivery",
    status: "idle",
    color_hex: "#34D399",
    weight_percent: 25,
    system_prompt: null,
    scoring_notes: null,
    wallet_address: null,
    created_at: new Date(0).toISOString(),
  },
];

function mergeNestedToolArguments(body: Record<string, unknown>): Record<string, unknown> {
  const nestedCandidates: unknown[] = [
    body.arguments,
    body.input,
    (body.params as Record<string, unknown> | undefined)?.arguments,
    (body.params as Record<string, unknown> | undefined)?.input,
  ];
  let merged = { ...body };
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      merged = { ...(candidate as Record<string, unknown>), ...merged };
    }
  }
  return merged;
}

function normalizeStringList(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

const MAX_WORKSPACE_FILES = 60;
const MAX_WORKSPACE_FILE_CHARS = 8_000;
const MAX_WORKSPACE_TOTAL_CHARS = 100_000;
const MAX_WORKSPACE_TREE = 80;

function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const tree = Array.isArray(obj.tree)
    ? obj.tree
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, MAX_WORKSPACE_TREE)
    : [];
  const filesRaw = Array.isArray(obj.files) ? obj.files : [];
  const files: WorkspaceSnapshot["files"] = [];
  let totalChars = 0;
  for (const file of filesRaw) {
    if (!file || typeof file !== "object" || Array.isArray(file)) continue;
    const path = typeof (file as { path?: unknown }).path === "string"
      ? (file as { path: string }).path.trim()
      : "";
    const content =
      typeof (file as { content?: unknown }).content === "string"
        ? (file as { content: string }).content
        : "";
    if (!path) continue;
    const clipped = content.slice(0, MAX_WORKSPACE_FILE_CHARS);
    totalChars += clipped.length;
    if (totalChars > MAX_WORKSPACE_TOTAL_CHARS) break;
    files.push({ path, content: clipped });
    if (files.length >= MAX_WORKSPACE_FILES) break;
  }
  if (tree.length === 0 && files.length === 0) return null;
  return {
    rootName: typeof obj.rootName === "string" ? obj.rootName.trim() : undefined,
    tree: tree.length > 0 ? tree : files.map((file) => file.path),
    files,
    demoUrl: typeof obj.demoUrl === "string" ? obj.demoUrl.trim() : undefined,
    gitRemote: typeof obj.gitRemote === "string" ? obj.gitRemote.trim() : undefined,
  };
}

function sanitizeAgentSlugs(value: unknown): string[] | undefined {
  const list = normalizeStringList(value);
  if (!Array.isArray(list)) return undefined;
  const slugs = list.filter(
    (slug): slug is string =>
      typeof slug === "string" &&
      VALID_AGENT_SLUGS.includes(slug as (typeof VALID_AGENT_SLUGS)[number]),
  );
  return slugs.length > 0 ? slugs : undefined;
}

function sanitizeGithubUrls(githubUrl: string, githubUrls: unknown): string[] {
  const candidates = [
    githubUrl,
    ...(Array.isArray(githubUrls) ? githubUrls : []),
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .filter((value) => Boolean(parseGitHubRepo(value)));
  return [...new Set(candidates)];
}

const handleJudge = async ({ request }: { request: Request }) => {
  try {
    console.log("HELLO_WORLD_JUDGE_API_CALLED_URL", request.url);
    const url = new URL(request.url);
    let body: Record<string, unknown> = {};
    if (request.method === "POST" || request.method === "PUT") {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch (e) {
        body = {};
      }
      body = mergeNestedToolArguments(body);
    }

    // Check for user prompt or message in common body fields or query params
    const promptKeys = ["prompt", "message", "content", "text", "query", "q", "msg"];
    let userPrompt = "";
    for (const key of promptKeys) {
      if (body[key] && typeof body[key] === "string") {
        userPrompt = body[key];
        break;
      }
      const paramVal = url.searchParams.get(key);
      if (paramVal) {
        userPrompt = paramVal;
        break;
      }
    }

    // Comprehensive parsing of repo URLs and description from body and search params
    const repoKeys = [
      "githubUrl",
      "github_url",
      "githubRepositoryUrl",
      "github_repository_url",
      "repository_url",
      "repositoryUrl",
      "repoUrl",
      "repo_url",
      "url",
      "repository",
      "repo",
      "git",
      "gitUrl",
      "git_url",
      "link",
    ];

    let githubUrl = "";
    for (const key of repoKeys) {
      if (body[key] && typeof body[key] === "string" && (body[key] as string).trim()) {
        githubUrl = (body[key] as string).trim();
        break;
      }
      const paramVal = url.searchParams.get(key);
      if (paramVal && paramVal.trim()) {
        githubUrl = paramVal.trim();
        break;
      }
    }

    const repoUrlsKeys = ["githubUrls", "github_urls", "repoUrls", "repo_urls", "urls"];
    let githubUrls: unknown = undefined;
    for (const key of repoUrlsKeys) {
      if (body[key]) {
        githubUrls = normalizeStringList(body[key]);
        break;
      }
      const paramVal = url.searchParams.get(key);
      if (paramVal) {
        githubUrls = normalizeStringList(paramVal);
        break;
      }
    }

    const descKeys = [
      "projectDescription",
      "project_description",
      "project",
      "taskDescription",
      "task_description",
      "task",
      "description",
      "prompt",
      "message",
      "content",
      "text",
      "query",
      "q",
      "msg",
      "brief",
      "hackathonBrief",
      "hackathon_brief",
    ];
    let description = "";
    for (const key of descKeys) {
      if (body[key] && typeof body[key] === "string" && (body[key] as string).trim()) {
        description = (body[key] as string).trim();
        break;
      }
      const paramVal = url.searchParams.get(key);
      if (paramVal && paramVal.trim()) {
        description = paramVal.trim();
        break;
      }
    }

    // Fail-safe scanner to pull any GitHub URLs from request body and search parameters
    const scannedUrls = [
      ...extractAllGitHubUrls(body),
      ...extractAllGitHubUrls(Object.fromEntries(url.searchParams.entries())),
    ];

    if (!githubUrl && scannedUrls.length > 0) {
      githubUrl = scannedUrls[0];
    }
    if (!githubUrls && scannedUrls.length > 0) {
      githubUrls = scannedUrls;
    }

    // If userPrompt is empty but description is found, use it
    if (!userPrompt && description) {
      userPrompt = description;
    }

    // If a user prompt was found, parse it for GitHub URLs and set description
    if (userPrompt) {
      const githubUrlRegex = /https?:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/gi;
      const matches = userPrompt.match(githubUrlRegex);
      if (matches && matches.length > 0) {
        if (!githubUrl) {
          githubUrl = matches[0];
        }
        if (!githubUrls) {
          githubUrls = matches;
        }
      }
      if (!description) {
        description = userPrompt;
      }
    }

    const hackathonBrief =
      (body["hackathonBrief"] as string | undefined) ||
      (body["brief"] as string | undefined) ||
      (body["hackathonDescription"] as string | undefined) ||
      url.searchParams.get("hackathonBrief") ||
      url.searchParams.get("brief");

    const hackathonName =
      (body["hackathonName"] as string | undefined) || url.searchParams.get("hackathonName");

    // Parse sandbox mode: defaults to false unless explicitly set to true.
    // A payment header always wins — paid marketplace replays must not drop into sandbox.
    let sandbox = false;
    if (body["sandbox"] !== undefined) {
      sandbox = Boolean(body["sandbox"]);
    } else if (url.searchParams.has("sandbox")) {
      sandbox = url.searchParams.get("sandbox") === "true";
    }

    let requestedAgentSlugs: unknown = sanitizeAgentSlugs(body["agents"]);
    if (requestedAgentSlugs === undefined && url.searchParams.has("agents")) {
      requestedAgentSlugs = sanitizeAgentSlugs(url.searchParams.get("agents"));
    }

    let txHash = (body["txHash"] as string | undefined) || url.searchParams.get("txHash");
    const workspaceSnapshot = parseWorkspaceSnapshot(
      body["workspaceSnapshot"] ?? body["workspace"] ?? body["workspace_snapshot"],
    );
    const demoUrl =
      (typeof body["demoUrl"] === "string" && body["demoUrl"].trim()) ||
      (typeof body["demo_url"] === "string" && body["demo_url"].trim()) ||
      workspaceSnapshot?.demoUrl ||
      url.searchParams.get("demoUrl") ||
      undefined;

    // Extract txHash from standard x402 headers if not in body/query params
    if (!txHash) {
      const headersToCheck = [
        "PAYMENT-SIGNATURE",
        "payment-signature",
        "X-PAYMENT",
        "x-payment",
        "Authorization",
        "authorization",
      ];
      for (const headerName of headersToCheck) {
        const val = request.headers.get(headerName);
        if (!val) continue;

        const cleanVal = val.replace(/^(Payment|Bearer)\s+/i, "").trim();
        if (cleanVal.startsWith("0x") && cleanVal.length === 66) {
          txHash = cleanVal;
          break;
        }

        // Try decoding as base64 JSON
        try {
          const decodedStr = Buffer.from(cleanVal, "base64").toString("utf-8");
          if (decodedStr.includes("{")) {
            const parsed = JSON.parse(decodedStr);
            if (parsed.txHash) {
              txHash = parsed.txHash;
              break;
            }
            if (parsed.transaction) {
              txHash = parsed.transaction;
              break;
            }
            if (parsed.payload?.txHash) {
              txHash = parsed.payload.txHash;
              break;
            }
            if (parsed.payload?.transaction) {
              txHash = parsed.payload.transaction;
              break;
            }
            if (parsed.authorization) {
              if (parsed.authorization.startsWith("0x") && parsed.authorization.length === 66) {
                txHash = parsed.authorization;
                break;
              }
            }
          }
        } catch (e) {
          // Ignore and continue
        }

        // Try parsing raw JSON
        if (cleanVal.includes("{")) {
          try {
            const parsed = JSON.parse(cleanVal) as Record<string, unknown>;
            if (parsed["txHash"]) {
              txHash = parsed["txHash"] as string;
              break;
            }
            if (parsed["transaction"]) {
              txHash = parsed["transaction"] as string;
              break;
            }
          } catch (e) {
            // Ignore parse errors on nested objects
          }
        }
      }
    }

    let paymentData: {
      kind: string;
      from_address: string | null;
      to_address: string;
      amount_usdc: number;
      circle_tx_id: string;
      status: string;
    } | null = null;
    let isReplay = false;

    // Define pricing standard for individual agents (USDT, decimals=6)
    const AGENTS_PRICING: Record<string, bigint> = {
      "vex-01": 250000n, // 0.25 USDT (Engineering)
      "kael-02": 250000n, // 0.25 USDT (Product/UX)
      "oryn-03": 250000n, // 0.25 USDT (Innovation)
      "zera-04": 250000n, // 0.25 USDT (Completeness/Docs)
    };

    // Default to all active agents if not provided or empty
    const defaultSlugs = ["vex-01", "kael-02", "oryn-03", "zera-04"];
    const targetAgentSlugs =
      Array.isArray(requestedAgentSlugs) && requestedAgentSlugs.length > 0
        ? requestedAgentSlugs.filter(
            (slug): slug is string => typeof slug === "string" && defaultSlugs.includes(slug),
          )
        : defaultSlugs;

    const urlsToAudit = sanitizeGithubUrls(githubUrl, githubUrls);
    if (urlsToAudit.length === 0) {
      if (workspaceSnapshot) {
        urlsToAudit.push(workspaceSnapshot.gitRemote || "workspace://local");
      } else {
        urlsToAudit.push(DEFAULT_GITHUB_URL);
      }
    }
    if (!description.trim()) {
      description = DEFAULT_DESCRIPTION;
    }

    const repoCount = urlsToAudit.length || 1;

    const feePerRepo = targetAgentSlugs.reduce(
      (sum, slug) => sum + (AGENTS_PRICING[slug] || 0n),
      0n,
    );
    const expectedMin = feePerRepo * BigInt(repoCount);
    const supabase = getSupabaseServerClient();
    const paymentSignature = resolveX402PaymentHeader(request.headers);
    if (paymentSignature || txHash) {
      sandbox = false;
    }
    const x402PaymentKey = paymentSignature ? createX402PaymentKey(paymentSignature) : null;
    const x402RequestFingerprint = paymentSignature
      ? createX402RequestFingerprint({
          repositories: urlsToAudit.map(normalizeGithubUrl),
          agentSlugs: [...targetAgentSlugs].sort(),
          description: description.trim(),
          hackathonBrief: hackathonBrief?.trim() || null,
          hackathonName: hackathonName?.trim() || null,
        })
      : null;

    if (!sandbox && !txHash && x402PaymentKey && x402RequestFingerprint) {
      const { data: cachedPayment, error: cachedPaymentError } = await supabase
        .from("payments")
        .select("from_address, to_address")
        .eq("circle_tx_id", x402PaymentKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cachedPaymentError) {
        console.error("[api/judge] Failed to check x402 replay cache:", cachedPaymentError);
      } else if (cachedPayment) {
        if (cachedPayment.from_address !== x402RequestFingerprint) {
          return Response.json(
            {
              ok: false,
              error:
                "This x402 payment authorization has already been used for a different audit request.",
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }

        const replayRecord = parseX402ReplayRecord(cachedPayment.to_address);
        if (!replayRecord || replayRecord.requestFingerprint !== x402RequestFingerprint) {
          return Response.json(
            {
              ok: false,
              error: "The cached result for this x402 payment is unavailable or invalid.",
              retryable: false,
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          {
            ...replayRecord.response,
            replayed: true,
            txHash: replayRecord.transaction ?? replayRecord.response.txHash,
          },
          {
            headers: {
              ...replayRecord.settlementHeaders,
              "Cache-Control": "private, no-store",
              "X-JuriXAI-Replay": "true",
            },
          },
        );
      }
    }

    // 1a. Standard x402 flow: Arc Mainnet USDC via the Arc facilitator.
    // Runs whenever the caller did not supply a legacy on-chain txHash.
    // - No PAYMENT-SIGNATURE header  -> standard 402 challenge (PAYMENT-REQUIRED header)
    // - Valid PAYMENT-SIGNATURE      -> verified; settlement executes after the audit
    // - Facilitator unavailable -> fall through to legacy Arc USDC txHash challenge
    let okxPayment: OkxPaymentResult | null = null;
    if (!sandbox && !txHash) {
      try {
        okxPayment = await processOkxPayment(request, body, {
          agentSlugs: targetAgentSlugs,
          repoCount,
        });
      } catch (error) {
        console.error("[api/judge] x402 request processing failed:", error);
        return Response.json(
          {
            ok: false,
            error:
              "Payment verification service is temporarily unavailable. Retry with the same payment authorization.",
            retryable: true,
          },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Retry-After": "5" },
          },
        );
      }
      if (okxPayment.type === "payment-error") {
        return instructionsToResponse(okxPayment.response);
      }
    }
    const okxVerified = okxPayment?.type === "payment-verified" ? okxPayment : null;

    // 1b. Legacy flow: verify a direct USDC transfer on Arc Mainnet by txHash.
    // Also serves the standard 402 challenge when the Arc facilitator is unavailable.
    if (!sandbox && !okxVerified) {
      if (!txHash) {
        return instructionsToResponse(
          buildPaymentRequiredResponse({
            resourceUrl: new URL(request.url).toString(),
            description: `JuriXAI Auditor: Modular multi-agent repository quality audit service (Agents: ${targetAgentSlugs.join(", ")}).`,
            amount: expectedMin,
            payTo: JURIX_X402_PAY_TO,
            errorMessage:
              "Payment required. Use a standard x402 PAYMENT-SIGNATURE header or provide a valid Arc Mainnet USDC txHash.",
          }),
        );
      }

      // Check if txHash has already been registered (prevents stealing/reusing transaction hashes)
      const { data: existingPayment } = await supabase
        .from("payments")
        .select("id, from_address")
        .eq("circle_tx_id", txHash)
        .maybeSingle();

      if (existingPayment) {
        const storedRepo = existingPayment.from_address
          ? normalizeGithubUrl(existingPayment.from_address)
          : "";
        const currentRepo = normalizeGithubUrl(urlsToAudit[0] || "");
        if (storedRepo && currentRepo && storedRepo === currentRepo) {
          isReplay = true;
        } else {
          return Response.json(
            {
              ok: false,
              error: "This transaction hash has already been used for a different repository.",
            },
            { status: 400 },
          );
        }
      }

      if (!isReplay) {
        const verifyRpc = "https://rpc.mainnet.arc.io";
        const verifyUsdc = ARC_USDC_ASSET;
        const verifyChainName = "Arc Mainnet";
        const verifyTokenSymbol = "USDC";

        const client = createPublicClient({ transport: http(verifyRpc) });
        let tx;
        let receipt;
        try {
          tx = await client.getTransaction({ hash: txHash as `0x${string}` });
          receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: `Failed to fetch transaction details on ${verifyChainName}. Verify the hash is correct and confirmed.`,
            },
            { status: 400 },
          );
        }

        if (receipt.status !== "success") {
          return Response.json(
            { ok: false, error: "Payment transaction has reverted or failed on-chain." },
            { status: 400 },
          );
        }

        const allowedContracts = [verifyUsdc.toLowerCase()];

        if (!tx.to || !allowedContracts.includes(tx.to.toLowerCase())) {
          return Response.json(
            {
              ok: false,
              error: `Transaction was not directed to the ${verifyChainName} ${verifyTokenSymbol} contract.`,
            },
            { status: 400 },
          );
        }

        try {
          const decoded = decodeFunctionData({
            abi: transferAbi,
            data: tx.input,
          });
          const recipient = decoded.args[0];
          const amount = decoded.args[1];

          if (recipient.toLowerCase() !== JURIX_X402_PAY_TO.toLowerCase()) {
            return Response.json(
              { ok: false, error: "Recipient is not the JuriXAI Auditor payment address." },
              { status: 400 },
            );
          }

          if (amount < expectedMin) {
            return Response.json(
              {
                ok: false,
                error: `Transaction amount is insufficient. Minimum required is ${Number(expectedMin) / 1000000} ${verifyTokenSymbol} for ${repoCount} repositories.`,
              },
              { status: 400 },
            );
          }

          // Save payment details to insert later after evaluations succeed
          paymentData = {
            kind: "entry",
            from_address: urlsToAudit[0] || null, // Store the audited repo URL
            to_address: recipient,
            amount_usdc: Number(amount) / 1000000,
            circle_tx_id: txHash,
            status: "confirmed",
          };
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error:
                "Invalid transaction structure or decoding failed. Make sure it is a standard USDC transfer.",
            },
            { status: 400 },
          );
        }
      }
    }

    // 2. Fetch active judge agents from database
    const { data: dbAgents, error: agentsError } = await supabase
      .from("judge_agents")
      .select("*")
      .order("weight_percent", { ascending: false });

    if (agentsError) {
      console.error("[api/judge] Failed to load judge agents:", agentsError.message);
    }

    const agents = ((dbAgents ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      short_code: row.short_code,
      role: row.role,
      focus_area: row.focus_area,
      status: row.status,
      color_hex: row.color_hex,
      weight_percent: row.weight_percent,
      system_prompt: row.system_prompt,
      scoring_notes: row.scoring_notes,
      wallet_address: row.wallet_address,
      created_at: row.created_at,
    })) as JudgeAgent[]).filter((agent) => defaultSlugs.includes(agent.slug));
    const resolvedAgents = agents.length > 0 ? agents : FALLBACK_JUDGE_AGENTS;

    // 3. Prepare mock summaries for evaluation
    const hackathon: HackathonSummary = {
      id: "api-judging",
      name: hackathonName || "API Judging Service",
      description: hackathonBrief || "AI Judge-as-a-Service pay-per-call API invocation",
      submission_instructions: null,
      required_deliverables: ["github"],
      organizer_name: "JurixAI ASP",
      organizer_email: "support@jurix.ai",
      prize_pool_usdc: 0,
      entry_fee_usdc: 0,
      start_date: new Date().toISOString(),
      deadline: new Date().toISOString(),
      status: "closed",
      treasury_wallet_id: null,
      treasury_address: null,
      winner_split: [100],
      created_at: new Date().toISOString(),
      submission_count: 1,
    };

    const batchResults = [];

    // Evaluate repositories sequentially to manage LLM rate limits cleanly
    for (let i = 0; i < urlsToAudit.length; i++) {
      const currentUrl = urlsToAudit[i];

      const submission: SubmissionSummary = {
        id: `api-submission-${i}`,
        hackathon_id: "api-judging",
        user_id: null,
        project_name: workspaceSnapshot?.rootName || `API Project Evaluation #${i + 1}`,
        team_name: "External Caller",
        description: description || "No description provided.",
        github_url: parseGitHubRepo(currentUrl) ? currentUrl : workspaceSnapshot?.gitRemote || null,
        demo_url: demoUrl || null,
        video_url: null,
        payout_address: "0x0000000000000000000000000000000000000000",
        entry_paid: true,
        status: "complete",
        community_votes: 0,
        created_at: new Date().toISOString(),
        weighted_score: 0,
      };

      const filteredAgents = resolvedAgents.filter((agent) =>
        targetAgentSlugs.includes(agent.slug),
      );
      const evaluations: Array<{
        agent: string;
        role: string;
        score: number | null;
        confidence: number;
        rationale: string;
        evidence: string[];
        flags: string[];
        locked?: boolean;
      }> = [];

      const evaluationResults = await Promise.all(
        filteredAgents.map(async (agent) => {
          const criteriaData = AGENT_CRITERIA_MAP[
            agent.slug as keyof typeof AGENT_CRITERIA_MAP
          ] || {
            name: `${agent.name} Evaluation`,
            description: agent.focus_area,
          };

          const criterion: JudgingCriterion = {
            id: agent.id,
            hackathon_id: "api-judging",
            agent_id: agent.id,
            name: criteriaData.name,
            description: criteriaData.description,
            weight_percent: agent.weight_percent,
            sort_order: 0,
            created_at: new Date().toISOString(),
          };

          // In sandbox mode, lock non-Vex agents to enforce payment upgrade
          if (sandbox && agent.slug !== "vex-01") {
            const individualCost = Number(AGENTS_PRICING[agent.slug] || 250n) / 1000000;
            return {
              agent: agent.name,
              role: agent.role,
              score: null,
              confidence: 0,
              rationale: `[🔒 Paid Upgrade Required] Detailed ${agent.role.toLowerCase()} audit is locked in Sandbox Mode. Send ${individualCost} USDT to unlock the individual agent evaluation, or 0.001 USDT to unlock the full 4-agent suite.`,
              evidence: [],
              flags: ["LOCKED_SANDBOX"],
              locked: true,
            };
          }

          try {
            const evaluation = await evaluateSubmissionWithModel(
              agent,
              criterion,
              hackathon,
              submission,
              {
                isDirectAudit: true,
                workspaceSnapshot,
                timeoutMs: sandbox ? undefined : PAID_AUDIT_MODEL_TIMEOUT_MS,
              },
            );
            return {
              agent: agent.name,
              role: agent.role,
              score: evaluation.score,
              confidence: evaluation.confidence,
              rationale: evaluation.rationale,
              evidence: evaluation.evidence,
              flags: evaluation.flags,
            };
          } catch (err) {
            console.error(`[api/judge] Agent ${agent.name} evaluation failed:`, err);
            return {
              agent: agent.name,
              role: agent.role,
              score: 6,
              confidence: 0.4,
              rationale: `Deterministic ${agent.role.toLowerCase()} audit after the live evaluator timed out or failed. The repository was still scored from public metadata.`,
              evidence: ["evaluator_error"],
              flags: ["fallback_scoring"],
            };
          }
        }),
      );
      evaluations.push(...evaluationResults);

      // Calculate a provisional score from completed dimensions. A public
      // average is only issued when all four advertised dimensions are scored.
      let totalWeight = 0;
      let weightedSum = 0;
      evaluations.forEach((ev) => {
        if (ev.score === null) return; // Ignore locked agents in average score
        const agent = resolvedAgents.find((a) => a.name === ev.agent);
        const weight = agent ? agent.weight_percent : 25;
        weightedSum += ev.score * weight;
        totalWeight += weight;
      });

      const evaluatedCount = evaluations.filter((ev) => ev.score !== null).length;
      const totalCount = defaultSlugs.length;
      const partialScore =
        evaluatedCount > 0 ? Number((weightedSum / totalWeight).toFixed(2)) : null;
      const hasAllDimensions = evaluations.length === totalCount && evaluatedCount === totalCount;
      const hasFallback = evaluations.some(
        (evaluation) =>
          evaluation.flags.includes("fallback_scoring") ||
          evaluation.evidence.some((item) => item.startsWith("model_error:")),
      );
      const averageScore = hasAllDimensions && !hasFallback ? partialScore : null;

      batchResults.push({
        githubUrl: currentUrl || workspaceSnapshot?.gitRemote || "workspace://local",
        evaluations,
        averageScore,
        partialScore,
        dimensionsEvaluated: evaluatedCount,
        totalDimensions: totalCount,
      });
    }

    if (batchResults.length === 0) {
      return Response.json(
        { ok: false, error: "Audit pipeline yielded no results." },
        { status: 500 },
      );
    }

    const fallbackEvaluations = batchResults.flatMap((result) =>
      result.evaluations.filter(
        (evaluation) =>
          evaluation.flags.includes("fallback_scoring") ||
          evaluation.evidence.some((item) => item.startsWith("model_error:")),
      ),
    );

    const fallbackUsed = fallbackEvaluations.length > 0;

    // Settle the standard x402 payment on Arc Mainnet now that the
    // audit has a deliverable. Settlement failure must not withhold the report
    // from a buyer who already completed payment.
    let settlementHeaders: Record<string, string> = {};
    if (okxVerified) {
      try {
        const settleResult = await okxVerified.settle();
        if (settleResult.success) {
          settlementHeaders = settleResult.headers;
          if (settleResult.transaction) {
            txHash = settleResult.transaction;
          }
          await supabase.from("payments").insert({
            kind: "entry",
            from_address: urlsToAudit[0] || null,
            to_address: JURIX_X402_PAY_TO,
            amount_usdc: Number(expectedMin) / 1000000,
            circle_tx_id: settleResult.transaction || `x402-${Date.now()}`,
            status: "confirmed",
          });
        } else {
          console.error("[api/judge] x402 settlement failed; delivering audit anyway");
        }
      } catch (error) {
        console.error("[api/judge] x402 settlement threw; delivering audit anyway:", error);
      }
    }

    // Log payment in DB now that the evaluations succeeded
    if (!sandbox && paymentData && !isReplay) {
      await supabase.from("payments").insert(paymentData);
    }

    const isSingle = urlsToAudit.length === 1;
    const reportText = generateTextReport(
      batchResults,
      sandbox,
      txHash || (sandbox ? "sandbox_mode" : "x402_settled"),
    );
    const responseBody = {
      ok: true,
      githubUrl: isSingle ? urlsToAudit[0] : undefined,
      txHash: txHash || (sandbox ? "sandbox_mode" : "x402_settled"),
      evaluations: isSingle ? batchResults[0]?.evaluations : undefined,
      averageScore: isSingle ? batchResults[0]?.averageScore : undefined,
      partialScore: isSingle ? batchResults[0]?.partialScore : undefined,
      dimensionsEvaluated: isSingle ? batchResults[0]?.dimensionsEvaluated : undefined,
      totalDimensions: isSingle ? batchResults[0]?.totalDimensions : undefined,
      averageScoreBasis: isSingle
        ? batchResults[0]?.averageScore !== null
          ? `all ${batchResults[0]?.totalDimensions} dimensions evaluated`
          : `not issued; ${batchResults[0]?.dimensionsEvaluated} of ${batchResults[0]?.totalDimensions} dimensions evaluated`
        : undefined,
      evaluationEngine: "0g_labs",
      fallbackUsed,
      results: batchResults,
      repoCount,
      report: reportText,
    };

    if (okxVerified && x402PaymentKey && x402RequestFingerprint) {
      const replayRecord = serializeX402ReplayRecord({
        version: 1,
        type: "jurixai-x402-audit",
        requestFingerprint: x402RequestFingerprint,
        transaction: txHash || null,
        response: responseBody,
        settlementHeaders,
      });
      const { error: replayCacheError } = await supabase.from("payments").insert({
        kind: "entry",
        from_address: x402RequestFingerprint,
        to_address: replayRecord,
        amount_usdc: Number(expectedMin) / 1000000,
        circle_tx_id: x402PaymentKey,
        status: "confirmed",
      });

      if (replayCacheError) {
        console.error("[api/judge] Failed to store x402 replay cache:", replayCacheError);
      }
    }

    // Print the report directly to the server terminal console
    console.log("\n" + reportText + "\n");

    return Response.json(responseBody, { headers: settlementHeaders });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Judging evaluation failed." },
      { status: 500 },
    );
  }
};

export const Route = createFileRoute("/api/judge")({
  server: {
    handlers: {
      GET: handleJudge,
      POST: handleJudge,
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            Allow: "GET, POST, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Accept, Authorization, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT",
          },
        }),
    },
  },
});
