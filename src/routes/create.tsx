import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  createHackathon,
  getOperatorUsdcBalance,
  getOperatorWalletAddress,
  loadHomeData,
} from "@/lib/jurix/actions.server";
import { useWallet } from "@/lib/circle/useWallet";
import { readUsdcBalance } from "@/lib/chain";
import { ShieldAlert } from "lucide-react";
import type { Session } from "@/lib/circle/userWallet";
import { circleAppId } from "@/lib/circle/appId";

export const Route = createFileRoute("/create")({
  loader: () => loadHomeData(),
  head: () => ({
    meta: [
      { title: "Host a Hackathon — JuriXAI" },
      {
        name: "description",
        content:
          "Spin up an autonomous hackathon: define criteria, fund a Circle wallet, and let AI agents handle judging.",
      },
    ],
  }),
  component: CreateHackathon,
});

type Criterion = {
  id: string;
  name: string;
  description: string;
  weight: number;
  agentId: string;
};

function buildHackathonDescription(
  summary: string,
  submissionInstructions: string,
  requiredDeliverables: string[],
) {
  const deliverables = requiredDeliverables
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");

  return [
    summary.trim(),
    "",
    "Submission Instructions:",
    submissionInstructions.trim(),
    "",
    "Required Deliverables:",
    deliverables || "- Not provided",
  ].join("\n");
}

function CreateHackathon() {
  const { wallet, profile } = useWallet();
  const navigate = useNavigate();
  const { active_agents } = Route.useLoaderData();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    organizerName: "",
    organizerEmail: "",
    description: "",
    submissionInstructions: "",
    requiredDeliverables: [
      "GitHub repository",
      "Problem solved and target users",
      "How to run or test the agent",
      "Optional live demo or walkthrough video",
    ],
    startDate: "",
    deadline: "",
    prizePoolUsdc: "50",
    winnerSplit: ["50", "30", "20"],
  });

  useEffect(() => {
    if (wallet && !form.organizerEmail) {
      setForm((prev) => ({
        ...prev,
        organizerEmail: wallet.identifier,
        organizerName: prev.organizerName || profile?.displayName || "",
      }));
    }
  }, [wallet, profile, form.organizerEmail]);

  const defaultAgents = active_agents.slice(0, 4);
  const [criteria, setCriteria] = useState<Criterion[]>(
    defaultAgents.map((agent, index) => ({
      id: `c${index + 1}`,
      name:
        index === 0
          ? "Technical Quality"
          : index === 1
            ? "Product Value"
            : index === 2
              ? "Originality"
              : "Documentation & Delivery",
      description: "",
      weight: agent.weight_percent,
      agentId: agent.id,
    })),
  );

  const steps = ["Basics", "Prize pool", "Criteria", "Review"];
  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);
  const splitSum = form.winnerSplit.reduce((sum, v) => sum + (Number(v) || 0), 0);

  const durationDays =
    form.startDate && form.deadline
      ? Math.ceil(
          (new Date(form.deadline).getTime() - new Date(form.startDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;
  const extraMonths = durationDays > 0 ? Math.floor(durationDays / 30) : 0;
  const adminFee = 10 + extraMonths;
  const totalFunding = Number(form.prizePoolUsdc || 0) + adminFee;

  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeFundingAmount, setActiveFundingAmount] = useState<number | null>(null);
  const [activeFundingRecipient, setActiveFundingRecipient] = useState<string | null>(null);
  const [activeFundingRecipientMinBalance, setActiveFundingRecipientMinBalance] = useState<
    number | null
  >(null);
  const [showPayConfirm, setShowPayConfirm] = useState(false);

  const isStepValid = () => {
    if (step === 0) {
      const slugifiedId = form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return (
        form.name.trim() !== "" &&
        slugifiedId !== "" &&
        form.organizerName.trim() !== "" &&
        form.organizerEmail.trim() !== "" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.organizerEmail.trim()) &&
        form.description.trim() !== "" &&
        form.submissionInstructions.trim() !== "" &&
        form.requiredDeliverables.length > 0 &&
        form.requiredDeliverables.every((d) => d.trim() !== "") &&
        form.startDate !== "" &&
        form.deadline !== "" &&
        new Date(form.deadline) > new Date(form.startDate)
      );
    }
    if (step === 1) {
      return (
        splitSum === 100 &&
        Number(form.prizePoolUsdc) > 0 &&
        form.winnerSplit.every((v) => v !== "" && Number(v) > 0)
      );
    }
    if (step === 2) {
      return (
        totalWeight === 100 &&
        criteria.every((c) => c.name.trim() !== "" && c.description.trim() !== "")
      );
    }
    return true;
  };

  const isFormValid = () => {
    const slugifiedId = form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const step0Valid = (
      form.name.trim() !== "" &&
      slugifiedId !== "" &&
      form.organizerName.trim() !== "" &&
      form.organizerEmail.trim() !== "" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.organizerEmail.trim()) &&
      form.description.trim() !== "" &&
      form.submissionInstructions.trim() !== "" &&
      form.requiredDeliverables.length > 0 &&
      form.requiredDeliverables.every((d) => d.trim() !== "") &&
      form.startDate !== "" &&
      form.deadline !== "" &&
      new Date(form.deadline) > new Date(form.startDate)
    );
    const step1Valid = (
      splitSum === 100 &&
      Number(form.prizePoolUsdc) > 0 &&
      form.winnerSplit.every((v) => v !== "" && Number(v) > 0)
    );
    const step2Valid = (
      totalWeight === 100 &&
      criteria.every((c) => c.name.trim() !== "" && c.description.trim() !== "")
    );
    return step0Valid && step1Valid && step2Valid;
  };

  async function handleCreate() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const slugifiedId = form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!form.name.trim() || !slugifiedId) {
        throw new Error("Hackathon name must contain at least one alphanumeric character.");
      }
      if (!form.organizerName.trim()) {
        throw new Error("Organizer name is required.");
      }
      if (!form.organizerEmail.trim()) {
        throw new Error("Organizer email is required.");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.organizerEmail.trim())) {
        throw new Error("Please enter a valid organizer email address.");
      }
      if (!form.description.trim()) {
        throw new Error("Description is required.");
      }
      if (!form.submissionInstructions.trim()) {
        throw new Error("Submission instructions are required.");
      }
      if (form.requiredDeliverables.length === 0 || form.requiredDeliverables.some((d) => !d.trim())) {
        throw new Error("All required deliverables must be filled out.");
      }
      if (!form.startDate) {
        throw new Error("Start date is required.");
      }
      if (!form.deadline) {
        throw new Error("Submission deadline is required.");
      }
      if (new Date(form.deadline) <= new Date(form.startDate)) {
        throw new Error("Submission deadline must be after the start date.");
      }
      if (form.winnerSplit.some((v) => v === "" || Number(v) <= 0)) {
        throw new Error("All winner split percentages must be greater than 0%.");
      }
      if (splitSum !== 100) {
        throw new Error("Winner split must sum to exactly 100%.");
      }
      if (criteria.some((c) => !c.name.trim() || !c.description.trim())) {
        throw new Error("All criteria names and descriptions for the AI agents must be filled out.");
      }
      if (totalWeight !== 100) {
        throw new Error("Judging criteria weights must sum to exactly 100%.");
      }
      if (Number(form.prizePoolUsdc) <= 0) {
        throw new Error("Prize pool must be greater than 0 USDC.");
      }

      const operatorAddress = await getOperatorWalletAddress();
      const operatorStartingBalance = await getOperatorUsdcBalance();

      // 1. Fetch the latest user smart account balance
      const freshBalance = await readUsdcBalance(wallet.address);
      if (freshBalance < totalFunding) {
        throw new Error(
          `Insufficient balance in your smart wallet. You have ${freshBalance.toFixed(2)} USDC, but total required funding is ${totalFunding.toFixed(2)} USDC. Please fund your profile account first.`,
        );
      }

      // 2. Prompt email OTP to login and get session (This opens the OTP iframe immediately under the click event)
      const { getEmailSession } = await import("@/lib/circle/userWallet");
      const session = await getEmailSession(wallet.identifier);
      if (!session || !session.userToken) {
        throw new Error("Failed to authenticate secure session.");
      }

      // 3. Generate the withdrawal challenge on the server
      const { createWithdrawalTransaction } = await import("@/lib/circle/userWallet.server");
      const tx = await createWithdrawalTransaction({
        data: {
          userToken: session.userToken,
          recipientAddress: operatorAddress,
          amount: totalFunding,
        },
      });

      if (!tx.challengeId) {
        throw new Error("Failed to generate payment challenge from Circle.");
      }

      // 4. Present the user-controlled payment authorization modal
      setActiveChallengeId(tx.challengeId);
      setActiveSession(session);
      setActiveFundingAmount(totalFunding);
      setActiveFundingRecipient(operatorAddress);
      setActiveFundingRecipientMinBalance(operatorStartingBalance + totalFunding);
      setShowPayConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate payment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecutePaymentChallenge() {
    if (
      !activeChallengeId ||
      !activeSession ||
      activeFundingAmount === null ||
      !activeFundingRecipient ||
      activeFundingRecipientMinBalance === null
    ) {
      return;
    }
    setShowPayConfirm(false);
    setBusy(true);
    setError(null);

    const tid = toast.loading("Launching secure verification window...");
    try {
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const { runChallenge } = await import("@/lib/circle/userWallet");

      const sdkChallenge = new W3SSdk({
        appSettings: { appId: circleAppId() },
      });
      sdkChallenge.setAuthentication({
        userToken: activeSession.userToken,
        encryptionKey: activeSession.encryptionKey,
      });

      // Execute inside the click handler so Chrome keeps the user gesture.
      await runChallenge(sdkChallenge, activeChallengeId);

      toast.loading("Payment authorized. Waiting for Circle to settle the USDC transfer...", {
        id: tid,
      });
      const { waitForFundingTransaction } = await import("@/lib/circle/userWallet.server");
      const funding = await waitForFundingTransaction({
        data: {
          userToken: activeSession.userToken,
          challengeId: activeChallengeId,
          expectedDestination: activeFundingRecipient,
          expectedAmount: activeFundingAmount,
          minimumDestinationBalance: activeFundingRecipientMinBalance,
        },
      });

      toast.loading(
        funding.txHash
          ? `Payment confirmed on-chain (${funding.txHash.slice(0, 10)}...). Deploying hackathon details...`
          : "Payment confirmed. Deploying hackathon details & judging criteria...",
        { id: tid },
      );

      const result = await createHackathon({
        data: {
          name: form.name,
          description: buildHackathonDescription(
            form.description,
            form.submissionInstructions,
            form.requiredDeliverables,
          ),
          organizer_name: form.organizerName,
          organizer_email: form.organizerEmail,
          prize_pool_usdc: Number(form.prizePoolUsdc),
          start_date: form.startDate,
          deadline: form.deadline,
          winner_split: form.winnerSplit.map((value) => Number(value)),
          criteria: criteria.map((criterion) => ({
            name: criterion.name,
            description: criterion.description,
            weight_percent: criterion.weight,
            agent_id: criterion.agentId,
          })),
        },
      });

      toast.success(
        result.escrowRegistered
          ? "Hackathon successfully deployed and funded!"
          : "Hackathon created. On-chain escrow registration is pending and will be retried — your event is saved.",
        { id: tid },
      );
      setActiveChallengeId(null);
      setActiveSession(null);
      setActiveFundingAmount(null);
      setActiveFundingRecipient(null);
      setActiveFundingRecipientMinBalance(null);
      await navigate({ to: "/hackathons/$id", params: { id: result.id } });
    } catch (err) {
      toast.dismiss(tid);
      setError(err instanceof Error ? err.message : "Failed to create hackathon.");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Sign in required</h1>
          <p className="text-sm text-muted-foreground mt-3 mb-6">
            You must create an account or log in to host a hackathon on JuriXAI.
          </p>
          <div className="flex flex-col gap-2.5">
            <Link
              to="/"
              className="w-full inline-flex justify-center items-center rounded-lg bg-accent text-accent-foreground px-5 py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl md:text-4xl font-bold italic tracking-tight mb-3">
          Host a hackathon
        </h1>
        <p className="text-muted-foreground max-w-xl">
          Four steps. Configure real judging criteria and create a live event in Supabase.
        </p>
      </header>

      <div className="flex gap-1 mb-8 rounded-lg border border-border bg-muted p-1">
        {steps.map((label, index) => (
          <div
            key={label}
            className={`flex-1 px-3 py-2 text-xs font-semibold text-center rounded-md transition-colors ${
              index === step
                ? "bg-accent text-accent-foreground shadow-sm"
                : index < step
                  ? "text-accent"
                  : "text-muted-foreground"
            }`}
          >
            <span className="opacity-60 mr-1">{index + 1}</span>
            {label}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        {step === 0 && (
          <>
            <Field
              label="Hackathon name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              required
            />
            {form.name && !form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") && (
              <p className="text-xs text-warn -mt-4">Hackathon name must contain at least one letter or number.</p>
            )}
            <Field
              label="Organizer name"
              value={form.organizerName}
              onChange={(value) => setForm({ ...form, organizerName: value })}
              required
            />
            <Field
              label="Organizer email"
              type="email"
              value={form.organizerEmail}
              onChange={(value) => setForm({ ...form, organizerEmail: value })}
              required
            />
            {form.organizerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.organizerEmail.trim()) && (
              <p className="text-xs text-warn -mt-4">Please enter a valid email address.</p>
            )}
            <Field
              label="Description"
              value={form.description}
              onChange={(value) => setForm({ ...form, description: value })}
              required
              textarea
            />
            <Field
              label="Submission instructions"
              value={form.submissionInstructions}
              onChange={(value) => setForm({ ...form, submissionInstructions: value })}
              required
              textarea
            />
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Required deliverables
                <span className="text-accent ml-1">*</span>
              </label>
              <div className="space-y-2">
                {form.requiredDeliverables.map((value, index) => (
                  <input
                    key={index}
                    value={value}
                    onChange={(e) => {
                      const next = [...form.requiredDeliverables];
                      next[index] = e.target.value;
                      setForm({ ...form, requiredDeliverables: next });
                    }}
                    className="w-full rounded-lg bg-background border border-border px-3.5 py-2 text-sm text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                ))}
              </div>
              {form.requiredDeliverables.some((d) => !d.trim()) && (
                <p className="text-xs text-warn mt-1.5">All required deliverables must be filled out.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Start date"
                type="date"
                value={form.startDate}
                onChange={(value) => setForm({ ...form, startDate: value })}
                required
              />
              <Field
                label="Submission deadline"
                type="date"
                value={form.deadline}
                onChange={(value) => setForm({ ...form, deadline: value })}
                required
              />
            </div>
            {form.startDate && form.deadline && new Date(form.deadline) <= new Date(form.startDate) && (
              <p className="text-xs text-warn">Submission deadline must be after the start date.</p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <Field
              label="Prize pool (USDC)"
              type="number"
              value={form.prizePoolUsdc}
              onChange={(value) => setForm({ ...form, prizePoolUsdc: value })}
              required
              mono
            />
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-foreground">
                  Winner split (% by rank)
                </label>
                <span
                  className={`text-xs font-semibold ${splitSum === 100 ? "text-accent" : "text-warn"}`}
                >
                  Total: {splitSum}% {splitSum === 100 ? "✓" : "(must sum to exactly 100%)"}
                </span>
              </div>

              {/* Preset buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, winnerSplit: ["50", "30", "20"] })}
                  className="rounded bg-muted hover:bg-border border border-border px-2.5 py-1 text-xs text-foreground transition-colors cursor-pointer"
                >
                  Top 3 (50/30/20)
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, winnerSplit: ["40", "25", "15", "12", "8"] })}
                  className="rounded bg-muted hover:bg-border border border-border px-2.5 py-1 text-xs text-foreground transition-colors cursor-pointer"
                >
                  Top 5 (40/25/15/12/8)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      winnerSplit: ["30", "20", "15", "10", "8", "6", "4", "3", "2", "2"],
                    })
                  }
                  className="rounded bg-muted hover:bg-border border border-border px-2.5 py-1 text-xs text-foreground transition-colors cursor-pointer"
                >
                  Top 10 (Graduated)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const N = form.winnerSplit.length;
                    const base = Math.floor(100 / N);
                    const remainder = 100 - base * N;
                    const newSplits = Array.from({ length: N }, (_, i) =>
                      String(base + (i < remainder ? 1 : 0)),
                    );
                    setForm({ ...form, winnerSplit: newSplits });
                  }}
                  className="rounded bg-muted hover:bg-border border border-border px-2.5 py-1 text-xs text-foreground transition-colors cursor-pointer"
                >
                  Split Evenly
                </button>
              </div>

              {/* Dynamic list of split inputs */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {form.winnerSplit.map((value, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground w-16">
                      Rank #{index + 1}:
                    </span>
                    <div className="relative flex-1">
                      <input
                        value={value}
                        type="number"
                        min="0"
                        max="100"
                        onChange={(e) => {
                          const next = [...form.winnerSplit];
                          next[index] = e.target.value;
                          setForm({ ...form, winnerSplit: next });
                        }}
                        className="w-full rounded-lg bg-background border border-border px-3.5 py-2 pr-8 text-sm font-mono text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-mono">
                        %
                      </span>
                    </div>
                    {form.winnerSplit.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = form.winnerSplit.filter((_, i) => i !== index);
                          setForm({ ...form, winnerSplit: next });
                        }}
                        className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-warn hover:border-warn/30 transition-colors cursor-pointer"
                        title="Remove Rank"
                      >
                        <svg
                          className="size-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Rank Button */}
              <button
                type="button"
                onClick={() => {
                  setForm({ ...form, winnerSplit: [...form.winnerSplit, "0"] });
                }}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-input transition-colors mt-2 cursor-pointer"
              >
                + Add Rank
              </button>
              {form.winnerSplit.some((v) => v === "" || Number(v) <= 0) && (
                <p className="text-xs text-warn mt-1.5">Each rank must have a split percentage greater than 0%.</p>
              )}
            </div>
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 text-sm space-y-3">
              <p className="font-semibold text-accent mb-1 text-base">
                Payment & Funding Calculation
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Hosting a hackathon requires funding the prize pool + a platform fee in **Arc
                USDC**. The platform fee includes a flat $10 base fee, plus an extra 10% ($1) for
                each full month of duration.
              </p>

              <div className="grid grid-cols-2 gap-y-2 border-t border-b border-border/80 py-3 font-mono text-xs text-foreground">
                <span className="text-muted-foreground">Prize Pool:</span>
                <span className="text-right font-bold">
                  {Number(form.prizePoolUsdc || 0).toLocaleString()} USDC
                </span>

                <span className="text-muted-foreground">Flat Admin Fee:</span>
                <span className="text-right">10 USDC</span>

                <span className="text-muted-foreground">
                  Duration Extra Fee ({durationDays} days):
                </span>
                <span className="text-right">{extraMonths.toLocaleString()} USDC</span>

                <span className="text-foreground font-semibold text-sm">
                  Total Required Funding:
                </span>
                <span className="text-right font-bold text-accent text-sm">
                  {totalFunding.toLocaleString()} USDC
                </span>
              </div>

              <p className="text-xs text-muted-foreground italic leading-relaxed">
                Note: Upon deployment, you will be prompted to authorize the transfer of the total
                required **Arc USDC** funding from your wallet directly to the secure Escrow Smart
                Contract. Once authorized, your hackathon will be instantly activated and fully
                funded.
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">Criteria · weight total</span>
              <span className={totalWeight === 100 ? "text-accent" : "text-warn"}>
                {totalWeight}% / 100%
              </span>
            </div>
            {criteria.map((criterion, index) => (
              <div
                key={criterion.id}
                className="rounded-xl border border-border bg-card p-4 grid grid-cols-12 gap-3 items-center shadow-sm"
              >
                <input
                  value={criterion.name}
                  placeholder="Criterion name *"
                  required
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((item, i) =>
                        i === index ? { ...item, name: e.target.value } : item,
                      ),
                    )
                  }
                  className={`col-span-4 bg-transparent border-b px-1 py-1 text-sm font-medium focus:outline-none transition-colors ${
                    criterion.name.trim() === "" ? "border-warn/60 focus:border-warn" : "border-border focus:border-accent"
                  }`}
                />
                <input
                  value={criterion.description}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((item, i) =>
                        i === index ? { ...item, description: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder="Judge instructions * (compulsory)"
                  required
                  className={`col-span-4 rounded-lg bg-background border px-2 py-1.5 text-xs text-foreground focus:outline-none transition-all ${
                    criterion.description.trim() === ""
                      ? "border-warn/60 focus:border-warn focus:ring-2 focus:ring-warn/20"
                      : "border-border focus:border-accent focus:ring-2 focus:ring-accent/20"
                  }`}
                />
                <select
                  value={criterion.agentId}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((item, i) =>
                        i === index ? { ...item, agentId: e.target.value } : item,
                      ),
                    )
                  }
                  className="col-span-2 rounded-lg bg-background border border-border px-2 py-1.5 text-xs font-medium text-ai focus:outline-none focus:border-accent"
                >
                  {active_agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={criterion.weight}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((item, i) =>
                        i === index ? { ...item, weight: Number(e.target.value) } : item,
                      ),
                    )
                  }
                  className="col-span-2 rounded-lg bg-background border border-border px-2 py-1.5 text-sm font-mono text-accent text-right focus:outline-none focus:border-accent"
                />
              </div>
            ))}
            {criteria.some((c) => !c.name.trim() || !c.description.trim()) && (
              <p className="text-xs text-warn mt-1">All criteria names and descriptions must be filled out.</p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="rounded-xl border border-border bg-card p-6 text-sm space-y-3 shadow-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Judges</span>
              <span className="font-medium text-ai">{active_agents.length} agents available</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Criteria</span>
              <span className="font-medium">{criteria.length} defined</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Required deliverables</span>
              <span className="font-medium">
                {form.requiredDeliverables.filter(Boolean).length} listed
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Weight total</span>
              <span className={`font-medium ${totalWeight === 100 ? "text-accent" : "text-warn"}`}>
                {totalWeight}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pipeline</span>
              <span className="font-medium">Submit → Score → Settle</span>
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Prize pool:</span>
                <span className="font-semibold tabular-nums">
                  {Number(form.prizePoolUsdc || 0).toLocaleString()} USDC
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Flat platform fee:</span>
                <span className="font-semibold tabular-nums">10 USDC</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Duration extra fee ({durationDays} days):
                </span>
                <span className="font-semibold tabular-nums">
                  {extraMonths.toLocaleString()} USDC
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold text-accent pt-1 border-t border-dashed border-border">
                <span className="text-foreground">Total required funding:</span>
                <span className="tabular-nums">{totalFunding.toLocaleString()} USDC</span>
              </div>
            </div>
            <p className="text-muted-foreground pt-3 border-t border-border leading-relaxed text-xs">
              This will create a live hackathon row and its judging criteria in Supabase
              immediately.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-warn">{error}</p>}

        <div className="pt-4 border-t border-border flex justify-between">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || busy}
            className="rounded-lg border border-border text-foreground px-5 py-3 text-sm font-semibold disabled:opacity-40 hover:bg-muted transition-colors"
          >
            ← Back
          </button>
          {step === steps.length - 1 ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy || !isFormValid()}
              className="rounded-lg bg-accent text-accent-foreground px-6 py-3 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              {busy ? "Creating…" : "Deploy hackathon"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!isStepValid()}
              className="rounded-lg bg-accent text-accent-foreground px-6 py-3 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              Continue →
            </button>
          )}
        </div>
      </div>

      {showPayConfirm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-card border border-border p-6 rounded-2xl max-w-sm w-full text-center space-y-4 shadow-xl">
            <div className="size-12 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto">
              <ShieldAlert className="size-6 text-accent animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Authorize Escrow Payment</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your payment of <strong>{totalFunding.toFixed(2)} USDC</strong> (Prize Pool + Platform
              Fee) is prepared.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Click the button below to launch the secure Circle keyboard and enter your PIN to
              authorize.
            </p>
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleExecutePaymentChallenge}
                className="w-full bg-accent hover:opacity-90 text-accent-foreground font-semibold py-2.5 rounded-xl text-sm transition-all shadow-md shadow-accent/20 cursor-pointer"
              >
                Open Secure PIN Keypad
              </button>
              <button
                type="button"
                onClick={() => setShowPayConfirm(false)}
                className="w-full bg-transparent border border-border text-foreground hover:bg-muted py-2.5 rounded-xl text-sm transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  textarea,
  type = "text",
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  textarea?: boolean;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label}
        {required && <span className="text-accent ml-1">*</span>}
      </label>
      {textarea ? (
        <textarea
          required={required}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg bg-background border border-border px-3.5 py-2 text-sm text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      ) : (
        <input
          required={required}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg bg-background border border-border px-3.5 py-2 text-sm text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
            mono ? "font-mono" : ""
          }`}
        />
      )}
    </div>
  );
}
