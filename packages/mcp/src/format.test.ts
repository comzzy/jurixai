import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCallResult, formatCompare, formatPreflight } from "./format.js";
import type { JudgeSuccess, PreflightResult } from "./types.js";

const sample: JudgeSuccess = {
  ok: true,
  txHash: "sandbox_mode",
  githubUrl: "https://github.com/a/a",
  evaluations: [
    {
      agent: "Vex",
      role: "Code Judge",
      score: 8.2,
      confidence: 0.7,
      rationale: "Solid structure.",
      evidence: ["package.json present"],
      flags: [],
    },
  ],
  averageScore: 8.2,
  partialScore: 8.2,
  dimensionsEvaluated: 1,
  totalDimensions: 4,
  results: [
    {
      githubUrl: "https://github.com/a/a",
      evaluations: [
        {
          agent: "Vex",
          role: "Code Judge",
          score: 8.2,
          confidence: 0.7,
          rationale: "Solid structure.",
          evidence: ["package.json present"],
          flags: [],
        },
      ],
      averageScore: 8.2,
      partialScore: 8.2,
      dimensionsEvaluated: 1,
      totalDimensions: 4,
    },
    {
      githubUrl: "https://github.com/b/b",
      evaluations: [
        {
          agent: "Vex",
          role: "Code Judge",
          score: 6.1,
          confidence: 0.6,
          rationale: "Thin tests.",
          evidence: ["no tests"],
          flags: ["no_tests"],
        },
      ],
      averageScore: 6.1,
      partialScore: 6.1,
      dimensionsEvaluated: 1,
      totalDimensions: 4,
    },
  ],
};

test("formatCallResult renders sandbox verdict", () => {
  const text = formatCallResult({ kind: "ok", data: sample }, "sandbox");
  assert.match(text, /JuriXAI audit \(sandbox\)/);
  assert.match(text, /Vex/);
  assert.match(text, /8\.20 \/ 10/);
});

test("formatCallResult renders payment challenge", () => {
  const text = formatCallResult(
    {
      kind: "payment_required",
      challenge: {
        status: 402,
        payTo: "0xabc",
        amount: "1000000",
        network: "eip155:5042",
        error: "Payment required",
        raw: { x402Version: 2 },
      },
    },
    "live",
  );
  assert.match(text, /Payment required/);
  assert.match(text, /0xabc/);
  assert.match(text, /JURIX_TX_HASH/);
});

test("formatCompare names the higher-scoring repo", () => {
  const text = formatCompare(sample, "sandbox");
  assert.match(text, /Winner: https:\/\/github.com\/a\/a/);
});

test("formatPreflight lists checks", () => {
  const result: PreflightResult = {
    ok: true,
    ready: false,
    scoreHint: 6.2,
    path: "/tmp/demo",
    flags: ["no_tests"],
    gitRemote: null,
    next: "fix tests",
    checks: [{ id: "tests", status: "fail", detail: "No test files detected." }],
  };
  const text = formatPreflight(result);
  assert.match(text, /\[FAIL\] tests/);
  assert.match(text, /no_tests/);
});
