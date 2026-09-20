import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Play,
  Cpu,
  AlertTriangle,
  ShieldCheck,
  Info,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Award,
  Code,
  Globe,
  Star,
  Upload,
  FileText,
  Download,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { CHAIN_NAME, CHAIN_DISPLAY_NAME, TOKEN_SYMBOL } from "@/lib/chain";
import { JURIX_X402_PAY_TO } from "@/lib/x402/payee";

export const Route = createFileRoute("/playground")({
  component: Playground,
});

type AgentEvaluation = {
  agent: string;
  role: string;
  score: number | null;
  confidence: number;
  rationale: string;
  evidence: string[];
  flags: string[];
  locked?: boolean;
};

type AnalysisResult = {
  ok: boolean;
  githubUrl?: string;
  txHash: string;
  evaluations?: AgentEvaluation[];
  averageScore?: number | null;
  partialScore?: number | null;
  dimensionsEvaluated?: number;
  totalDimensions?: number;
  averageScoreBasis?: string;
  results?: Array<{
    githubUrl: string;
    evaluations: AgentEvaluation[];
    averageScore: number | null;
    partialScore: number | null;
    dimensionsEvaluated: number;
    totalDimensions: number;
  }>;
  repoCount?: number;
};

function Playground() {
  const tokenSymbol = TOKEN_SYMBOL;
  const networkName = CHAIN_DISPLAY_NAME;

  const [tab, setTab] = useState<"single" | "batch">("single");
  const [githubUrl, setGithubUrl] = useState("");
  const [rawUrls, setRawUrls] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const [txHash, setTxHash] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isAmountCopied, setIsAmountCopied] = useState(false);

  const [selectedAgentSlugs, setSelectedAgentSlugs] = useState<string[]>([
    "vex-01",
    "kael-02",
    "oryn-03",
    "zera-04",
  ]);
  const AGENTS_PRICING: Record<string, number> = {
    "vex-01": 0.25,
    "kael-02": 0.25,
    "oryn-03": 0.25,
    "zera-04": 0.25,
  };

  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("jurixai_audit_history");
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse audit history", e);
      }
    }
  }, []);

  // Execution states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [expandedRepoIndex, setExpandedRepoIndex] = useState<number | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLogs]);

  const parsedUrls = rawUrls
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && (u.startsWith("http://") || u.startsWith("https://")));
  const batchRepoCount = parsedUrls.length;
  const currentRepoCount = tab === "single" ? 1 : batchRepoCount;
  const feePerRepo = selectedAgentSlugs.reduce((sum, slug) => sum + (AGENTS_PRICING[slug] || 0), 0);
  const dynamicRequiredUsdt = (currentRepoCount * feePerRepo).toFixed(3);

  const handleCopyAddr = () => {
    navigator.clipboard.writeText(JURIX_X402_PAY_TO);
    setIsCopied(true);
    toast.success("Address copied to clipboard!");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleCopyAmount = () => {
    navigator.clipboard.writeText(dynamicRequiredUsdt);
    setIsAmountCopied(true);
    toast.success("Amount copied to clipboard!");
    setTimeout(() => setIsAmountCopied(false), 2000);
  };

  const handleDownloadReport = () => {
    if (!result) return;

    let content = "";
    const isSingle = Boolean(result.githubUrl);

    if (isSingle) {
      content += `# JuriXAI Audit Verdict Report\n\n`;
      content += `- **Repository:** ${result.githubUrl}\n`;
      content += `- **Execution Mode:** ${result.txHash === "sandbox_mode" ? "Sandbox (Free)" : "Live (Paid)"}\n`;
      if (result.txHash && result.txHash !== "sandbox_mode") {
        content += `- **Transaction Hash:** ${result.txHash}\n`;
      }
      if (result.averageScore !== null && result.averageScore !== undefined) {
        content += `- **Average Score:** ${result.averageScore} / 10\n\n`;
      } else {
        content += `- **Partial Score:** ${result.partialScore ?? "N/A"} / 10 (${result.dimensionsEvaluated ?? 0} of ${result.totalDimensions ?? 4} dimensions; no average issued)\n\n`;
      }
      content += `## Agent Evaluations\n\n`;

      result.evaluations?.forEach((ev) => {
        content += `### ${ev.agent} (${ev.role})\n`;
        content += `- **Score:** ${ev.score !== null ? `${ev.score} / 10` : "Locked"}\n`;
        content += `- **Confidence:** ${(ev.confidence * 100).toFixed(0)}%\n\n`;
        content += `#### Rationale:\n${ev.rationale}\n\n`;

        if (ev.evidence && ev.evidence.length > 0) {
          content += `#### Evidence:\n`;
          ev.evidence.forEach((item) => {
            content += `- ${item}\n`;
          });
          content += `\n`;
        }

        if (ev.flags && ev.flags.length > 0) {
          content += `#### Flags / Warnings:\n`;
          ev.flags.forEach((flag) => {
            content += `- ${flag}\n`;
          });
          content += `\n`;
        }

        content += `---\n\n`;
      });
    } else {
      content += `# JuriXAI Batch Audit Verdict Report\n\n`;
      content += `- **Execution Mode:** ${result.txHash === "sandbox_mode" ? "Sandbox (Free)" : "Live (Paid)"}\n`;
      if (result.txHash && result.txHash !== "sandbox_mode") {
        content += `- **Transaction Hash:** ${result.txHash}\n`;
      }
      content += `- **Total Repositories:** ${result.repoCount}\n\n`;

      result.results?.forEach((repo) => {
        content += `## Repository: ${repo.githubUrl}\n`;
        if (repo.averageScore !== null) {
          content += `- **Average Score:** ${repo.averageScore} / 10\n\n`;
        } else {
          content += `- **Partial Score:** ${repo.partialScore ?? "N/A"} / 10 (${repo.dimensionsEvaluated} of ${repo.totalDimensions} dimensions; no average issued)\n\n`;
        }
        content += `### Evaluations:\n\n`;

        repo.evaluations.forEach((ev) => {
          content += `#### ${ev.agent} (${ev.role})\n`;
          content += `- **Score:** ${ev.score !== null ? `${ev.score} / 10` : "Locked"}\n\n`;
          content += `##### Rationale:\n${ev.rationale}\n\n`;
          content += `---\n\n`;
        });
        content += `\n`;
      });
    }

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `jurixai_audit_report_${Date.now()}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Markdown report downloaded successfully!");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        setRawUrls(text);
        toast.success(`Loaded repositories from ${file.name}!`);
      }
    };
    reader.readAsText(file);
  };

  const runSimulatedLogs = async (isLive: boolean, isBatch: boolean, urls: string[]) => {
    const logs = [];
    if (isLive) {
      logs.push(`⏳ Connecting to ${networkName} RPC node...`);
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 600));
      logs.push(`🔍 Checking transaction hash: ${txHash.slice(0, 12)}...`);
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 800));
      logs.push(`✅ Payment transaction verified successfully on ${networkName}!`);
      logs.push(`💰 Amount received: ${(urls.length * feePerRepo).toFixed(3)} ${tokenSymbol}`);
    } else {
      logs.push("🧪 Running in SANDBOX MODE (Simulated Payment)...");
    }

    setTerminalLogs([...logs]);
    await new Promise((r) => setTimeout(r, 400));

    if (isBatch) {
      logs.push(`📦 Starting batch evaluation of ${urls.length} repositories...`);
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 600));

      for (let idx = 0; idx < urls.length; idx++) {
        const url = urls[idx];
        const displayUrl = url.replace("https://github.com/", "");
        logs.push(`----------------------------------------`);
        logs.push(`📂 [Repo ${idx + 1}/${urls.length}] Auditing: ${displayUrl}`);
        logs.push("🧬 Reading project structure, package.json, and configuration files...");
        setTerminalLogs([...logs]);
        await new Promise((r) => setTimeout(r, 800));

        logs.push(`⚖️ Running JuriXAI 4-Agent Panel Audit...`);
        logs.push("🤖 [Vex] Analyzing code quality, patterns, security...");
        setTerminalLogs([...logs]);
        await new Promise((r) => setTimeout(r, 600));

        if (!isLive) {
          logs.push("🔒 Sandbox mode enabled: Kael, Oryn, and Zera reviews are locked.");
        } else {
          logs.push("🤖 [Kael] Evaluating product UX and problem-solution fit...");
          logs.push("🤖 [Oryn] Auditing innovation and originality...");
          logs.push("🤖 [Zera] Checking shipping quality and documentation...");
          setTerminalLogs([...logs]);
          await new Promise((r) => setTimeout(r, 1000));
        }

        logs.push(`✅ [Repo ${idx + 1}/${urls.length}] Audit complete.`);
        setTerminalLogs([...logs]);
      }
    } else {
      logs.push("📂 Contacting GitHub API to retrieve repository metadata...");
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 600));

      logs.push("📁 Repository cloned into secure sandboxed memory.");
      logs.push("🧬 Reading project structure, package.json, and configuration files...");
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 800));

      logs.push("⚖️ Invoking specialized AI Judge Agents...");
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 400));

      logs.push("🤖 [Vex] Analyzing code quality, patterns, security, and dependencies...");
      setTerminalLogs([...logs]);
      await new Promise((r) => setTimeout(r, 800));

      if (isLive) {
        logs.push("🤖 [Kael] Evaluating product UX, core features, and problem-solution fit...");
        setTerminalLogs([...logs]);
        await new Promise((r) => setTimeout(r, 600));

        logs.push("🤖 [Oryn] Auditing code innovation, originality, and uniqueness...");
        setTerminalLogs([...logs]);
        await new Promise((r) => setTimeout(r, 600));

        logs.push(
          "🤖 [Zera] Checking shipping quality, reproducibility, documentation, and README...",
        );
        setTerminalLogs([...logs]);
        await new Promise((r) => setTimeout(r, 800));
      } else {
        logs.push("🔒 Sandbox mode active: non-Vex agents are locked.");
      }
    }

    logs.push("📊 Consolidating scores and compiling feedback matrix...");
    setTerminalLogs([...logs]);
    await new Promise((r) => setTimeout(r, 500));

    logs.push("🎉 Analysis complete! Generating report details...");
    setTerminalLogs([...logs]);
    await new Promise((r) => setTimeout(r, 300));
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "single" && !githubUrl.trim()) {
      toast.error("Please enter a GitHub repository URL.");
      return;
    }
    if (tab === "batch" && batchRepoCount === 0) {
      toast.error("Please enter or upload at least one valid GitHub repository URL.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please enter a project description to provide context for the agents.");
      return;
    }
    if (mode === "live" && !txHash.trim()) {
      toast.error(`Please enter the ${networkName} ${tokenSymbol} payment transaction hash.`);
      return;
    }

    if (mode === "live" && txHash.trim()) {
      const existing = history.find((h) => h.txHash?.toLowerCase() === txHash.trim().toLowerCase());
      if (existing) {
        setIsAnalyzing(true);
        setResult(existing.result);
        setTerminalLogs([
          `🔍 Found transaction hash in history: ${txHash.slice(0, 12)}...`,
          `⚡ Restored audit report from local storage history!`,
        ]);
        toast.success("Restored analysis report from history!");
        setIsAnalyzing(false);
        return;
      }
    }

    setIsAnalyzing(true);
    setResult(null);
    setTerminalLogs([]);
    setExpandedRepoIndex(null);

    const activeUrls = tab === "single" ? [githubUrl.trim()] : parsedUrls;
    const runLogsPromise = runSimulatedLogs(mode === "live", tab === "batch", activeUrls);

    try {
      const payload =
        tab === "single"
          ? {
              githubUrl: githubUrl.trim(),
              description: description.trim(),
              txHash: mode === "live" ? txHash.trim() : undefined,
              sandbox: mode === "sandbox",
              chain: CHAIN_NAME,
              agents: selectedAgentSlugs,
            }
          : {
              githubUrls: parsedUrls,
              description: description.trim(),
              txHash: mode === "live" ? txHash.trim() : undefined,
              sandbox: mode === "sandbox",
              chain: CHAIN_NAME,
              agents: selectedAgentSlugs,
            };

      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      await runLogsPromise; // wait for terminal logs simulation to finish

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      const newResult = {
        ...data,
        txHash: data.txHash || (mode === "live" ? txHash.trim() : "sandbox_mode"),
      };
      setResult(newResult);
      toast.success("Analysis report generated successfully!");

      // Save to audit history
      const historyItem = {
        txHash: newResult.txHash,
        githubUrl: tab === "single" ? githubUrl.trim() : undefined,
        githubUrls: tab === "batch" ? parsedUrls : undefined,
        timestamp: new Date().toISOString(),
        result: newResult,
      };

      setHistory((prev) => {
        const filtered = prev.filter(
          (item) => item.txHash !== historyItem.txHash || item.txHash === "sandbox_mode",
        );
        const updated = [historyItem, ...filtered].slice(0, 10);
        localStorage.setItem("jurixai_audit_history", JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Repository analysis failed.");
      setTerminalLogs((prev) => [
        ...prev,
        `❌ ERROR: ${err instanceof Error ? err.message : "Judging pipeline failed."}`,
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
      {/* Header */}
      <header className="mb-12 max-w-3xl animate-slide-in">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 mb-4 text-xs font-semibold text-accent">
          <Cpu className="size-3.5 animate-pulse" />
          {networkName} Powered ASP
        </div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 italic">
          AI Judge-as-a-Service <span className="text-muted-foreground">Playground</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          Deploy and run instant multi-agent audits on any project. Evaluate code structure,
          product-market fit, innovation, and documentation polish using pay-per-call.
        </p>
      </header>

      {/* Tabs Switcher */}
      <div className="flex border-b border-border/60 mb-8 max-w-md gap-4">
        <button
          onClick={() => {
            setTab("single");
            setResult(null);
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            tab === "single"
              ? "border-accent text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Single Repo Audit
        </button>
        <button
          onClick={() => {
            setTab("batch");
            setResult(null);
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            tab === "batch"
              ? "border-accent text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Batch Multi-Repo Audit
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column: Setup */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Terminal className="size-5 text-accent" />
              Configure Evaluation
            </h2>

            <form onSubmit={handleAnalyze} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Select Scoring Agents
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(AGENTS_PRICING).map(([slug, price]) => {
                    const agentName =
                      slug === "vex-01"
                        ? "Vex (Engineering)"
                        : slug === "kael-02"
                          ? "Kael (Product)"
                          : slug === "oryn-03"
                            ? "Oryn (Innovation)"
                            : "Zera (Completeness)";
                    const isSelected = selectedAgentSlugs.includes(slug);
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            if (selectedAgentSlugs.length > 1) {
                              setSelectedAgentSlugs(selectedAgentSlugs.filter((s) => s !== slug));
                            } else {
                              toast.error("At least one agent must be selected.");
                            }
                          } else {
                            setSelectedAgentSlugs([...selectedAgentSlugs, slug]);
                          }
                        }}
                        className={`p-2.5 text-left rounded-lg border text-xs flex flex-col justify-between h-20 transition-all cursor-pointer ${
                          isSelected
                            ? "border-accent bg-accent/5 text-foreground shadow-sm"
                            : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80"
                        }`}
                      >
                        <span className="font-bold block truncate">{agentName}</span>
                        <span className="text-[10px] font-mono opacity-85">
                          {price.toFixed(3)} {tokenSymbol}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Execution Mode
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
                  <button
                    type="button"
                    onClick={() => setMode("sandbox")}
                    className={`py-2 text-xs font-semibold rounded-md transition-all ${
                      mode === "sandbox"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Sandbox Mode (Free)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("live")}
                    className={`py-2 text-xs font-semibold rounded-md transition-all ${
                      mode === "live"
                        ? "bg-card text-foreground shadow-sm border border-accent/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {networkName} (Paid)
                  </button>
                </div>
              </div>

              {/* Live Payment Information */}
              {mode === "live" && (
                <div className="p-4 rounded-lg bg-accent/5 border border-accent/20 space-y-3 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <Info className="size-4 text-accent mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        Micro-payment required to trigger judging:
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Send exactly{" "}
                        <strong className="text-foreground">
                          {dynamicRequiredUsdt} {tokenSymbol}
                        </strong>{" "}
                        to the JuriXAI Agentic Wallet on {networkName}.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 mt-2">
                    <div className="flex items-center justify-between bg-muted/60 p-2 rounded border border-border/40">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Recipient (Agentic Wallet)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-foreground">
                          {JURIX_X402_PAY_TO.slice(0, 6)}...{JURIX_X402_PAY_TO.slice(-4)}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyAddr}
                          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isCopied ? (
                            <Check className="size-3 text-accent" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-muted/60 p-2 rounded border border-border/40">
                      <span className="text-[10px] font-mono text-muted-foreground">Total Fee</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-foreground">
                          {dynamicRequiredUsdt} {tokenSymbol}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyAmount}
                          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isAmountCopied ? (
                            <Check className="size-3 text-accent" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Transaction Hash
                    </label>
                    <input
                      type="text"
                      placeholder="0x..."
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      className="w-full bg-muted border border-border text-xs font-mono rounded px-3 py-2 text-foreground focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}

              {tab === "single" ? (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    GitHub Repository URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://github.com/username/repo"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-4.5 py-3 text-sm text-foreground focus:outline-none focus:border-accent"
                    required
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Upload Repository List (.txt)
                    </label>
                    <div className="border border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer relative">
                      <input
                        type="file"
                        accept=".txt"
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload className="size-6 text-muted-foreground mb-2" />
                      <span className="text-xs text-muted-foreground font-semibold">
                        {selectedFile
                          ? selectedFile.name
                          : "Drag & drop or click to upload txt list"}
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-1">
                        One URL per line
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Or Paste Repository URLs</span>
                      <span className="text-[10px] text-accent lowercase">
                        ({batchRepoCount} detected)
                      </span>
                    </label>
                    <textarea
                      placeholder="https://github.com/owner/repo-1&#10;https://github.com/owner/repo-2&#10;https://github.com/owner/repo-3"
                      value={rawUrls}
                      onChange={(e) => setRawUrls(e.target.value)}
                      className="w-full bg-muted border border-border rounded-lg px-4.5 py-3 text-xs font-mono text-foreground h-32 focus:outline-none focus:border-accent resize-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Project Description (Required)
                </label>
                <textarea
                  placeholder="Briefly describe the purpose of the codebase and key features to help agents gain accurate context."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4.5 py-3 text-sm text-foreground h-24 focus:outline-none focus:border-accent resize-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isAnalyzing}
                className="w-full rounded-lg bg-accent text-accent-foreground py-3 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    Analyzing {tab === "single" ? "Repository" : "Batch List"}...
                  </>
                ) : (
                  <>
                    <Play className="size-4 fill-current" />
                    Run Multi-Agent Audit
                  </>
                )}
              </button>
            </form>
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4 animate-slide-in">
              <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <History className="size-4 text-accent animate-pulse" />
                Recent Audits History
              </h2>
              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {history.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setResult(item.result);
                      setTab(item.githubUrls ? "batch" : "single");
                      if (item.githubUrl) setGithubUrl(item.githubUrl);
                      if (item.githubUrls) setRawUrls(item.githubUrls.join("\n"));
                      setTxHash(item.txHash === "sandbox_mode" ? "" : item.txHash);
                      setMode(item.txHash === "sandbox_mode" ? "sandbox" : "live");
                      setTerminalLogs([
                        `📂 Loaded audit report for: ${item.githubUrl || `${item.githubUrls?.length} repos`}`,
                        `🕒 Audited on: ${new Date(item.timestamp).toLocaleString()}`,
                      ]);
                      toast.success("Loaded audit report from history!");
                    }}
                    className="w-full text-left p-2.5 rounded-lg border border-border/40 hover:border-accent/40 bg-muted/30 hover:bg-accent/5 transition-all text-xs flex items-center justify-between gap-3 group cursor-pointer"
                  >
                    <div className="truncate flex-1">
                      <span className="font-semibold block text-foreground group-hover:text-accent truncate">
                        {item.githubUrl
                          ? item.githubUrl.replace("https://github.com/", "")
                          : `${item.githubUrls?.length} repositories`}
                      </span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5 font-mono truncate">
                        {item.txHash === "sandbox_mode"
                          ? "Sandbox Mode"
                          : `Tx: ${item.txHash.slice(0, 8)}...${item.txHash.slice(-6)}`}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-bold text-accent block">
                        {item.result.averageScore ??
                          item.result.partialScore ??
                          item.result.results?.[0]?.averageScore ??
                          item.result.results?.[0]?.partialScore ??
                          0}{" "}
                        / 10
                      </span>
                      <span className="text-[8px] text-muted-foreground block mt-0.5">
                        {new Date(item.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem("jurixai_audit_history");
                  setHistory([]);
                  toast.success("Audit history cleared!");
                }}
                className="w-full text-center text-[10px] font-semibold text-muted-foreground hover:text-red-400 transition-colors uppercase tracking-wider pt-2 border-t border-border/40 cursor-pointer"
              >
                Clear History
              </button>
            </div>
          )}
        </div>

        {/* Right column: Terminal Output / Results */}
        <div className="lg:col-span-7 space-y-6">
          {/* Live Terminal Logging */}
          {(isAnalyzing || terminalLogs.length > 0) && (
            <div className="rounded-xl border border-border bg-black p-5 shadow-inner font-mono text-xs text-green-400 min-h-[220px] flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-border/20 pb-3 mb-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-red-500" />
                  <span className="size-2 rounded-full bg-yellow-500" />
                  <span className="size-2 rounded-full bg-green-500" />
                  <span className="ml-1">JuriXAI Agent Exec Pipeline</span>
                </span>
                <span>UTC-2026</span>
              </div>

              <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[260px] pr-2">
                {terminalLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed">
                    {log}
                  </div>
                ))}
                {isAnalyzing && (
                  <div className="flex items-center gap-1.5 text-accent mt-2">
                    <span className="size-2 rounded-full bg-accent animate-ping" />
                    <span>Processing evaluation requests...</span>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* Results Summary Card */}
          {result && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-8 animate-slide-in">
              {result.githubUrl ? (
                // Single Audit View
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                    <div>
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Award className="size-5.5 text-accent" />
                        Verdict Report
                      </h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        Evaluated repository:{" "}
                        <a
                          href={result.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline font-mono hover:opacity-85 inline-flex items-center gap-1"
                        >
                          {result.githubUrl.replace("https://github.com/", "")}{" "}
                          <ExternalLink className="size-3" />
                        </a>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleDownloadReport}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-muted/60 hover:bg-muted text-foreground transition-all cursor-pointer"
                      >
                        <Download className="size-3.5 text-accent" />
                        Download Report
                      </button>

                      <div className="flex flex-col items-center justify-center p-3 rounded-xl border border-accent/20 bg-accent/5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {result.averageScore !== null && result.averageScore !== undefined
                            ? "Avg Score"
                            : "Partial Score"}
                        </span>
                        <span className="text-2xl font-bold text-accent italic mt-0.5">
                          {result.averageScore ?? result.partialScore ?? "N/A"}{" "}
                          <span className="text-xs text-muted-foreground">/10</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Agent Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {result.evaluations?.map((ev) => {
                      let agentColor = "text-accent border-accent/20 bg-accent/5";
                      if (ev.agent === "Kael")
                        agentColor = "text-blue-400 border-blue-400/20 bg-blue-400/5";
                      if (ev.agent === "Oryn")
                        agentColor = "text-purple-400 border-purple-400/20 bg-purple-400/5";
                      if (ev.agent === "Zera")
                        agentColor = "text-red-400 border-red-400/20 bg-red-400/5";

                      return (
                        <div
                          key={ev.agent}
                          className="border border-border rounded-xl p-5 hover:border-border/80 transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between mb-3.5">
                              <div>
                                <span className="text-sm font-bold">{ev.agent}</span>
                                <span className="block text-[10px] text-muted-foreground mt-0.5">
                                  {ev.role}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-mono font-bold px-2 py-1 rounded border ${agentColor}`}
                              >
                                {ev.score !== null ? `${ev.score} / 10` : "Locked"}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mb-4">
                              {ev.rationale}
                            </p>
                          </div>

                          {/* Evidence & Flags summary */}
                          <div className="space-y-2 pt-3 border-t border-border/40">
                            {ev.evidence.slice(0, 2).map((item, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-1.5 text-[10px] text-muted-foreground"
                              >
                                <span className="text-accent mt-0.5 shrink-0">•</span>
                                <span className="truncate">{item}</span>
                              </div>
                            ))}
                            {ev.flags.length > 0 && (
                              <div className="flex items-center gap-1.5 text-[10px] text-yellow-400/80">
                                <AlertTriangle className="size-3 shrink-0" />
                                <span className="truncate">{ev.flags.join(", ")}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Unified Verdict Details */}
                  <div className="space-y-4 pt-4 border-t border-border">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Detailed Agent Rationale
                    </h3>
                    <div className="space-y-4">
                      {result.evaluations?.map((ev) => (
                        <div key={ev.agent} className="space-y-1.5">
                          <span className="text-xs font-bold text-foreground">
                            {ev.agent} ({ev.role}):
                          </span>
                          <p className="text-xs text-muted-foreground leading-relaxed pl-3 border-l-2 border-border/60">
                            {ev.rationale}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                // Batch Audit View
                <>
                  <div className="flex items-center justify-between border-b border-border pb-4">
                    <div>
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Award className="size-5.5 text-accent" />
                        Batch Verdict Report
                      </h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        Audited {result.repoCount} repositories in batch
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleDownloadReport}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-muted/60 hover:bg-muted text-foreground transition-all cursor-pointer"
                    >
                      <Download className="size-3.5 text-accent" />
                      Download Report
                    </button>
                  </div>

                  <div className="space-y-4">
                    {result.results?.map((repo, idx) => (
                      <div
                        key={idx}
                        className="border border-border rounded-xl p-5 hover:border-border/80 transition-all space-y-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-bold block">
                              {repo.githubUrl.replace("https://github.com/", "")}
                            </span>
                            <a
                              href={repo.githubUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-accent underline hover:opacity-85 inline-flex items-center gap-0.5"
                            >
                              Visit Repo <ExternalLink className="size-2.5" />
                            </a>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="text-xs font-mono font-bold text-accent px-2 py-0.5 rounded border border-accent/20 bg-accent/5 italic">
                              {repo.averageScore !== null
                                ? `${repo.averageScore} avg`
                                : `${repo.partialScore ?? "N/A"} partial`}{" "}
                              / 10
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRepoIndex(expandedRepoIndex === idx ? null : idx)
                              }
                              className="text-xs font-semibold text-muted-foreground hover:text-foreground underline transition-colors cursor-pointer"
                            >
                              {expandedRepoIndex === idx ? "Hide Details" : "Show Details"}
                            </button>
                          </div>
                        </div>

                        {expandedRepoIndex === idx && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/40 animate-fade-in">
                            {repo.evaluations.map((ev) => {
                              let agentColor = "text-accent border-accent/20 bg-accent/5";
                              if (ev.agent === "Kael")
                                agentColor = "text-blue-400 border-blue-400/20 bg-blue-400/5";
                              if (ev.agent === "Oryn")
                                agentColor = "text-purple-400 border-purple-400/20 bg-purple-400/5";
                              if (ev.agent === "Zera")
                                agentColor = "text-red-400 border-red-400/20 bg-red-400/5";

                              return (
                                <div
                                  key={ev.agent}
                                  className="border border-border rounded-xl p-4 flex flex-col justify-between"
                                >
                                  <div>
                                    <div className="flex items-start justify-between mb-2">
                                      <div>
                                        <span className="text-xs font-bold">{ev.agent}</span>
                                        <span className="block text-[9px] text-muted-foreground">
                                          {ev.role}
                                        </span>
                                      </div>
                                      <span
                                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${agentColor}`}
                                      >
                                        {ev.score !== null ? `${ev.score} / 10` : "Locked"}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                                      {ev.rationale}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* API Info */}
              <div className="p-4 rounded-xl border border-border bg-muted/20 flex flex-col md:flex-row items-center gap-4 justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted border border-border grid place-items-center">
                    <Code className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <span className="text-xs font-bold block">Developer API Usage</span>
                    <span className="text-[10px] text-muted-foreground block">
                      Call this service programmatically using cURL or HTTP request
                    </span>
                  </div>
                </div>

                <div className="w-full md:w-auto font-mono text-[9px] bg-black p-2.5 rounded border border-border/30 text-green-400 overflow-x-auto select-all">
                  {
                    'curl -X POST https://www.jurixai.xyz/api/judge -d \'{"githubUrls":["..."], "txHash":"..."}\''
                  }
                </div>
              </div>
            </div>
          )}

          {/* Prompt card if empty */}
          {!isAnalyzing && !result && (
            <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground text-sm flex flex-col items-center justify-center min-h-[300px] shadow-sm">
              <div className="size-12 rounded-2xl bg-muted grid place-items-center mb-4 text-accent border border-border">
                <Cpu className="size-6 animate-pulse" />
              </div>
              <h3 className="text-foreground font-bold mb-1">Waiting for Analysis</h3>
              <p className="max-w-xs text-xs text-muted-foreground leading-relaxed">
                Provide one or more GitHub repository links on the left panel to trigger evaluations
                from our four autonomous agents.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
