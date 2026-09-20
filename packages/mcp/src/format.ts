import { AGENT_META, FULL_PANEL_PRICE_USDC, PAY_TO } from "./constants.js";
import type {
  AgentEvaluation,
  JudgeCallResult,
  JudgeSuccess,
  PaymentChallenge,
  PreflightResult,
  RepoVerdict,
} from "./types.js";

function scoreLine(evaluation: AgentEvaluation): string {
  const score = evaluation.score == null ? "locked" : `${evaluation.score.toFixed(2)} / 10`;
  const flags = evaluation.flags?.length ? evaluation.flags.join(", ") : "none";
  const evidence = (evaluation.evidence || []).map((item) => `    - ${item}`).join("\n");
  return [
    `### ${evaluation.agent} — ${evaluation.role}`,
    `- Score: ${score}`,
    `- Confidence: ${Math.round((evaluation.confidence || 0) * 100)}%`,
    `- Flags: ${flags}`,
    `- Rationale: ${evaluation.rationale}`,
    evidence ? `- Evidence:\n${evidence}` : "- Evidence: none",
  ].join("\n");
}

function verdictBlock(verdict: RepoVerdict): string {
  const average =
    verdict.averageScore != null
      ? `${verdict.averageScore} / 10`
      : verdict.partialScore != null
        ? `${verdict.partialScore} / 10 (partial, ${verdict.dimensionsEvaluated}/${verdict.totalDimensions} dimensions)`
        : "not issued";
  return [
    `## ${verdict.githubUrl}`,
    `Average: ${average}`,
    "",
    ...verdict.evaluations.map(scoreLine),
  ].join("\n");
}

export function formatSuccess(data: JudgeSuccess, mode: string): string {
  const results: RepoVerdict[] =
    data.results && data.results.length > 0
      ? data.results
      : [
          {
            githubUrl: data.githubUrl || "workspace://local",
            evaluations: data.evaluations || [],
            averageScore: data.averageScore ?? null,
            partialScore: data.partialScore ?? null,
            dimensionsEvaluated: data.dimensionsEvaluated ?? 0,
            totalDimensions: data.totalDimensions ?? 4,
          },
        ];

  const locked = results.some((result) => result.evaluations.some((item) => item.locked));
  const lines = [
    `# JuriXAI audit (${mode})`,
    `tx: ${data.txHash}`,
    data.evaluationEngine ? `engine: ${data.evaluationEngine}` : null,
    "",
    ...results.map(verdictBlock),
  ].filter((line) => line != null) as string[];

  if (locked) {
    lines.push(
      "",
      "Sandbox only unlocks Vex. Set `JURIX_MODE=live` and pay ~1 USDC/USDT for the full panel (Kael, Oryn, Zera).",
    );
  }

  lines.push("", "## Raw JSON", "```json", JSON.stringify(data, null, 2), "```");
  return lines.join("\n");
}

export function formatPaymentRequired(challenge: PaymentChallenge): string {
  const amount =
    challenge.amount && /^\d+$/.test(challenge.amount)
      ? `${Number(challenge.amount) / 1_000_000} (atomic ${challenge.amount})`
      : challenge.amount || `${FULL_PANEL_PRICE_USDC} USDC`;
  return [
    "# Payment required",
    challenge.error || "Live JuriXAI audits settle on-chain before the panel runs.",
    "",
    `- Network: ${challenge.network || "eip155:5042 (Arc Mainnet)"}`,
    `- Pay to: ${challenge.payTo || PAY_TO}`,
    `- Amount: ${amount}`,
    `- Per judge: 0.25 · Full panel: ${FULL_PANEL_PRICE_USDC}`,
    "",
    "How to pay from this MCP:",
    "1. Send the required Arc Mainnet USDC to the pay-to address, or attach an x402 PAYMENT-SIGNATURE.",
    "2. Set `JURIX_MODE=live`.",
    "3. Set `JURIX_TX_HASH` to the transfer hash, or `JURIX_PAYMENT_SIGNATURE` to the x402 header.",
    "4. Call this tool again with the same arguments.",
    "",
    "Agents: " +
      Object.entries(AGENT_META)
        .map(([slug, meta]) => `${meta.name} (${slug}) ${meta.priceUsdc}`)
        .join(" · "),
    "",
    "```json",
    JSON.stringify(challenge.raw ?? challenge, null, 2),
    "```",
  ].join("\n");
}

export function formatError(status: number, error: string, raw?: unknown): string {
  return [
    `# JuriXAI error${status ? ` (HTTP ${status})` : ""}`,
    error,
    raw ? `\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatCallResult(result: JudgeCallResult, mode: string): string {
  if (result.kind === "ok") return formatSuccess(result.data, mode);
  if (result.kind === "payment_required") return formatPaymentRequired(result.challenge);
  return formatError(result.status, result.error, result.raw);
}

export function formatPreflight(result: PreflightResult): string {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const checks = result.checks
    .map((check) => `- [${icon[check.status]}] ${check.id}: ${check.detail}`)
    .join("\n");
  return [
    `# JuriXAI preflight`,
    `Path: ${result.path}`,
    `Ready: ${result.ready ? "yes" : "no"}`,
    `Score hint: ${result.scoreHint} / 10 (heuristic, not the live panel)`,
    `Flags: ${result.flags.length ? result.flags.join(", ") : "none"}`,
    result.gitRemote ? `Git remote: ${result.gitRemote}` : "Git remote: none",
    "",
    checks,
    "",
    result.next,
  ].join("\n");
}

export function formatCompare(data: JudgeSuccess, mode: string): string {
  const results = data.results || [];
  if (results.length < 2) return formatSuccess(data, mode);

  const [a, b] = results;
  const avg = (verdict: RepoVerdict) => verdict.averageScore ?? verdict.partialScore;
  const aAvg = avg(a);
  const bAvg = avg(b);
  let winner = "tie / incomplete";
  if (aAvg != null && bAvg != null) {
    winner = aAvg === bAvg ? "tie" : aAvg > bAvg ? a.githubUrl : b.githubUrl;
  }

  return [
    `# JuriXAI compare (${mode})`,
    `Winner: ${winner}`,
    `- A ${a.githubUrl}: ${aAvg ?? "n/a"}`,
    `- B ${b.githubUrl}: ${bAvg ?? "n/a"}`,
    "",
    formatSuccess(data, mode),
  ].join("\n");
}
