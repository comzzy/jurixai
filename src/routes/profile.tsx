import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Copy,
  RefreshCw,
  Wallet,
  Edit3,
  Github,
  ExternalLink,
  Video,
  Plus,
  Users,
  MapPin,
  Globe,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWallet } from "@/lib/circle/useWallet";
import { explorerAddr, CHAIN_DISPLAY_NAME, CIRCLE_CHAIN_CODE } from "@/lib/chain";
import { readArcUsdcBalance } from "@/lib/arc";
import { truncateAddr } from "@/lib/format";
import {
  loadHostedHackathons,
  loadJoinedSubmissions,
  updateSubmission,
} from "@/lib/jurix/actions.server";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Dashboard — JuriXAI" }] }),
  component: ProfileRoute,
});

function ProfileRoute() {
  const { wallet, profile, profileBusy, saveProfile } = useWallet();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [payoutEvmAddress, setPayoutEvmAddress] = useState("");
  const [payoutChain, setPayoutChain] = useState("");
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [joinedSubmissions, setJoinedSubmissions] = useState<any[]>([]);
  const [loadingJoined, setLoadingJoined] = useState(false);
  const [hostedHackathons, setHostedHackathons] = useState<any[]>([]);
  const [loadingHosted, setLoadingHosted] = useState(false);

  const fetchJoined = useCallback(async () => {
    if (!wallet) return;
    setLoadingJoined(true);
    try {
      const data = await loadJoinedSubmissions();
      setJoinedSubmissions(data);
    } catch (e) {
      console.error("Failed to load joined submissions:", e);
    } finally {
      setLoadingJoined(false);
    }
  }, [wallet]);

  const fetchHosted = useCallback(async () => {
    if (!wallet) return;
    setLoadingHosted(true);
    try {
      const data = await loadHostedHackathons();
      setHostedHackathons(data);
    } catch (e) {
      console.error("Failed to load hosted hackathons:", e);
    } finally {
      setLoadingHosted(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchJoined();
    fetchHosted();
  }, [fetchJoined, fetchHosted]);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setBio(profile?.bio ?? "");
    setLocation(profile?.location ?? "");
    setWebsite(profile?.website ?? "");
    setPayoutEvmAddress(profile?.payoutEvmAddress ?? wallet?.address ?? "");
    setPayoutChain(profile?.payoutChain ?? CIRCLE_CHAIN_CODE);
  }, [profile, wallet]);

  if (!wallet) {
    return (
      <section className="mx-auto max-w-3xl px-6 py-20">
        <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Wallet className="size-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account first</h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Your dashboard, profile, and Arc wallet appear here once you sign in with email.
          </p>
          <Link
            to="/"
            className="mt-7 inline-flex rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            Back home
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground">
            Dashboard
          </p>
          <h1 className="mt-2 text-3xl font-bold italic tracking-tight">Your account</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
          {wallet.identifier} · {CHAIN_DISPLAY_NAME}
        </div>
      </header>

      {/* Balance — the hero card */}
      <BalanceCard
        address={wallet.address}
        email={wallet.identifier}
        payoutEvmAddress={payoutEvmAddress}
      />

      {/* Hackathons you host */}
      <HostedHackathonsList
        hackathons={hostedHackathons}
        loading={loadingHosted}
        onRefresh={fetchHosted}
      />

      {/* Joined Hackathons List */}
      <JoinedHackathonsList
        submissions={joinedSubmissions}
        loading={loadingJoined}
        onRefresh={fetchJoined}
      />

      {/* Two columns: profile form + side settings */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Public profile */}
        <div className="rounded-2xl border border-border bg-card p-7 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-5">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Public profile</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                How builders and judges see you across JuriXAI.
              </p>
            </div>
            {!isEditingProfile && (
              <button
                type="button"
                onClick={() => setIsEditingProfile(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <Edit3 className="size-3.5" /> Edit profile
              </button>
            )}
          </div>

          {!isEditingProfile ? (
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="size-12 shrink-0 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-lg border border-accent/20">
                  {(displayName || wallet.identifier || "A").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-foreground">
                    {displayName || "Anonymous Builder"}
                  </h3>
                  {bio ? (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {bio}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground italic">No bio has been added yet.</p>
                  )}
                </div>
              </div>

              {(location || website) && (
                <div className="pt-4 border-t border-border/60 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  {location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-3.5" /> {location}
                    </span>
                  )}
                  {website && (
                    <a
                      href={website.startsWith("http") ? website : `https://${website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <Globe className="size-3.5" /> {website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await saveProfile({
                    displayName,
                    bio,
                    location,
                    website,
                    payoutEvmAddress,
                    payoutChain,
                  });
                  toast.success("Profile saved");
                  setIsEditingProfile(false);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to save profile.");
                }
              }}
            >
              <Field label="Display name">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name or team name"
                  className={inputClass}
                />
              </Field>

              <Field label="Bio">
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell builders and judges who you are."
                  className="min-h-28 rounded-xl"
                />
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Location">
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Berlin, Lagos, Remote"
                    className={inputClass}
                  />
                </Field>
                <Field label="Website">
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://..."
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={profileBusy}
                  className="inline-flex rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {profileBusy ? "Saving…" : "Save profile"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDisplayName(profile?.displayName ?? "");
                    setBio(profile?.bio ?? "");
                    setLocation(profile?.location ?? "");
                    setWebsite(profile?.website ?? "");
                    setIsEditingProfile(false);
                  }}
                  className="inline-flex rounded-lg border border-border bg-transparent px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Side: wallet + payout */}
        <aside className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground">
              Registration wallet
            </p>
            <p className="mt-3 break-all font-mono text-sm text-foreground">{wallet.address}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(wallet.address);
                  toast.success("Wallet address copied");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-input hover:text-foreground transition-colors"
              >
                <Copy className="size-3.5" /> Copy
              </button>
              <a
                href={explorerAddr(wallet.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-input hover:text-foreground transition-colors"
              >
                <ArrowUpRight className="size-3.5" /> Explorer
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              This is the gasless Circle wallet created at signup. Arc USDC prizes land here.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Prominent Arc USDC balance card with deposit + (soon) withdraw. */
function BalanceCard({
  address,
  email,
  payoutEvmAddress,
}: {
  address: string;
  email: string;
  payoutEvmAddress: string;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Dialog States
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [recipient, setRecipient] = useState(payoutEvmAddress || "");
  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setBalance(await readArcUsdcBalance(address));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (payoutEvmAddress) {
      setRecipient(payoutEvmAddress);
    }
  }, [payoutEvmAddress]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient.trim()) {
      toast.error("Withdrawal Address required", {
        description: "Please enter a destination EVM address.",
      });
      return;
    }
    const val = Number(amount);
    if (Number.isNaN(val) || val <= 0) {
      toast.error("Invalid amount", { description: "Please enter a valid positive USDC amount." });
      return;
    }
    const gasReserve = 0.02;
    if (balance !== null && val > balance) {
      toast.error("Insufficient balance", {
        description: `Your maximum withdrawable balance is ${balance} USDC.`,
      });
      return;
    }
    if (balance !== null && val > Math.max(0, balance - gasReserve)) {
      toast.error("Leave a little USDC for gas", {
        description: `Arc fees are paid in USDC. Withdraw at most ${(balance - gasReserve).toFixed(2)} USDC so the transfer can complete.`,
      });
      return;
    }

    setWithdrawing(true);
    setIsWithdrawOpen(false);
    toast.info("Initiating withdrawal...", {
      description: "Enter the email code, then your 6-digit PIN, in the Circle window.",
    });
    try {
      const { executeWithdrawal } = await import("@/lib/circle/userWallet");
      await executeWithdrawal(email, recipient.trim(), val);
      toast.success("Withdrawal initiated!", {
        description: `Successfully sent ${val} USDC to ${recipient.trim()}. Balance will update once confirmed on-chain.`,
        duration: 6000,
      });
      setIsWithdrawOpen(false);
      setAmount("");

      // Wait 4 seconds for the transaction to be mined before reloading balance
      setTimeout(() => {
        void load();
      }, 4000);
    } catch (err) {
      toast.error("Withdrawal failed", {
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm">
      <div className="pointer-events-none absolute -right-16 -top-16 size-52 rounded-full bg-accent/5 blur-2xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground">
              Wallet balance · Arc
            </p>
            <button
              type="button"
              onClick={() => void load()}
              title="Refresh balance"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight tabular-nums">
              {loading
                ? "—"
                : failed
                  ? "—"
                  : (balance ?? 0).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
            </span>
            <span className="mb-1 text-sm font-semibold text-muted-foreground">USDC</span>
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {truncateAddr(address)}
            {failed ? " · balance unavailable — retry" : ""}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsDepositOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
          >
            <ArrowDownToLine className="size-4" /> Deposit
          </button>
          <button
            type="button"
            onClick={() => setIsWithdrawOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            <ArrowUpRight className="size-4" /> Withdraw
          </button>
        </div>
      </div>

      {/* Deposit Dialog with QR Code and Copy Address */}
      <Dialog open={isDepositOpen} onOpenChange={setIsDepositOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogTitle className="text-xl font-bold tracking-tight italic text-center">
            Receive USDC
          </DialogTitle>
          <div className="mt-4 flex flex-col items-center gap-5">
            {/* QR Code Container */}
            <div className="rounded-xl border border-border bg-white p-3 shadow-inner">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${address}`}
                alt="Deposit QR Code"
                width={200}
                height={200}
                className="size-44 object-contain"
              />
            </div>

            {/* Instructions */}
            <p className="text-center text-xs text-muted-foreground leading-relaxed max-w-[280px]">
              Scan this code to send USDC (or native gas tokens) on {CHAIN_DISPLAY_NAME} to your
              smart wallet.
            </p>

            {/* Address Row */}
            <div className="w-full flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground select-all break-all gap-2">
              <span className="truncate flex-1">{address}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(address);
                  toast.success("Wallet address copied");
                }}
                className="shrink-0 rounded bg-accent px-2 py-1 text-[10px] font-semibold text-accent-foreground hover:opacity-90 transition-opacity"
              >
                Copy
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdraw Dialog */}
      <Dialog open={isWithdrawOpen} onOpenChange={setIsWithdrawOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogTitle className="text-xl font-bold tracking-tight italic">
            Withdraw USDC
          </DialogTitle>
          <p className="text-xs text-muted-foreground -mt-2">
            Send Arc USDC from your smart wallet to any Arc Mainnet address. After the email
            code, enter your 6-digit PIN. Leave a little USDC in the wallet for gas — withdrawing
            the full balance can fail.
          </p>
          <form onSubmit={handleWithdraw} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Recipient EVM Address
              </label>
              <input
                required
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  USDC Amount
                </label>
                <button
                  type="button"
                  onClick={() => balance !== null && setAmount(balance.toFixed(6))}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Max ({balance !== null ? balance.toFixed(2) : "0.00"} USDC)
                </button>
              </div>
              <input
                required
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="flex gap-3 pt-3">
              <button
                type="button"
                disabled={withdrawing}
                onClick={() => setIsWithdrawOpen(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={withdrawing}
                className="flex-1 rounded-xl bg-accent text-accent-foreground py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {withdrawing ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Confirm"
                )}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

interface EditSubmissionDialogProps {
  submission: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function EditSubmissionDialog({
  submission,
  open,
  onOpenChange,
  onSaved,
}: EditSubmissionDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    projectName: submission.project_name || "",
    teamName: submission.team_name || "",
    description: submission.description || "",
    githubUrl: submission.github_url || "",
    demoUrl: submission.demo_url || "",
    videoUrl: submission.video_url || "",
    payoutAddress: submission.payout_address || "",
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateSubmission({
        data: {
          submission_id: submission.id,
          project_name: form.projectName,
          team_name: form.teamName,
          description: form.description,
          github_url: form.githubUrl,
          demo_url: form.demoUrl || undefined,
          video_url: form.videoUrl || undefined,
          payout_address: form.payoutAddress,
        },
      });
      toast.success("Submission updated successfully!");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update submission.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl p-6 overflow-y-auto max-h-[90vh] bg-card text-card-foreground border border-border">
        <DialogTitle className="text-xl font-bold tracking-tight">Edit Submission</DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Make changes to your project for <strong>{submission.hackathons?.name}</strong>.
        </p>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Project name <span className="text-accent">*</span>
            </label>
            <input
              required
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              placeholder="E.g. JuriXAI"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Team name <span className="text-accent">*</span>
            </label>
            <input
              required
              value={form.teamName}
              onChange={(e) => setForm({ ...form, teamName: e.target.value })}
              placeholder="E.g. Antigravity Crew"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              One-line description <span className="text-accent">*</span>
            </label>
            <Textarea
              required
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does your project do?"
              className="min-h-20 rounded-xl bg-background border border-border px-3.5 py-2 text-sm text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                GitHub repo URL <span className="text-accent">*</span>
              </label>
              <input
                required
                type="url"
                value={form.githubUrl}
                onChange={(e) => setForm({ ...form, githubUrl: e.target.value })}
                placeholder="https://github.com/..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Live demo URL (optional)
              </label>
              <input
                type="url"
                value={form.demoUrl}
                onChange={(e) => setForm({ ...form, demoUrl: e.target.value })}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Video demo URL (optional)
              </label>
              <input
                type="url"
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Prize payout address <span className="text-accent">*</span>
              </label>
              <input
                required
                value={form.payoutAddress}
                onChange={(e) => setForm({ ...form, payoutAddress: e.target.value })}
                placeholder="0x..."
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>

          {error && <p className="text-sm text-warn font-medium">{error}</p>}

          <div className="pt-4 border-t border-border flex justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted transition-colors cursor-pointer text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-accent text-accent-foreground px-5 py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              {busy ? "Saving changes..." : "Save changes"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HostedHackathonsList({
  hackathons,
  loading,
  onRefresh,
}: {
  hackathons: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const statusStyle = (status: string) =>
    status === "open"
      ? "bg-emerald-500/10 text-emerald-400"
      : status === "judging"
        ? "bg-ai/10 text-ai"
        : "bg-muted text-muted-foreground";

  return (
    <div className="mt-10 rounded-2xl border border-border bg-card p-7 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Hackathons you host</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Events created from this account. Judging triggers automatically when the deadline
            passes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-input hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link
            to="/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="size-3.5" /> Host new
          </Link>
        </div>
      </div>

      {loading && hackathons.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Loading your hackathons...
        </div>
      ) : hackathons.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          <p className="mb-4">You haven't hosted a hackathon yet.</p>
          <Link
            to="/create"
            className="inline-flex rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            Host a Hackathon
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {hackathons.map((h) => (
            <Link
              key={h.id}
              to="/hackathons/$id"
              params={{ id: h.id }}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/30 p-5 transition hover:border-border/80 hover:shadow-sm"
            >
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold tracking-tight text-foreground">
                  {h.name}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" />
                    {h.submission_count} submission{h.submission_count === 1 ? "" : "s"}
                  </span>
                  <span className="font-mono">
                    {Number(h.prize_pool_usdc).toLocaleString("en-US")} USDC
                  </span>
                </div>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusStyle(
                  h.status,
                )}`}
              >
                {h.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function JoinedHackathonsList({
  submissions,
  loading,
  onRefresh,
}: {
  submissions: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [editingSubmission, setEditingSubmission] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isOngoing = (sub: any) => {
    const hackathon = Array.isArray(sub.hackathons) ? sub.hackathons[0] : sub.hackathons;
    if (!hackathon) return false;
    if (hackathon.status !== "open") return false;
    if (hackathon.deadline) {
      return new Date(hackathon.deadline) > new Date();
    }
    return true;
  };

  const getStatusLabel = (sub: any) => {
    const hackathon = Array.isArray(sub.hackathons) ? sub.hackathons[0] : sub.hackathons;
    if (!hackathon) return "Unknown";
    if (hackathon.status !== "open") {
      return hackathon.status === "judging" ? "Judging in Progress" : "Closed";
    }
    if (hackathon.deadline && new Date(hackathon.deadline) < new Date()) {
      return "Deadline Passed";
    }
    return "Ongoing";
  };

  return (
    <div className="mt-10 rounded-2xl border border-border bg-card p-7 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Your Hackathon Registrations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hackathons you've joined and your submitted project details.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-input hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && submissions.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Loading your registrations...
        </div>
      ) : submissions.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          <p className="mb-4">You haven't submitted any projects yet.</p>
          <Link
            to="/hackathons"
            className="inline-flex rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            Browse Active Hackathons
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {submissions.map((sub) => {
            const hackathon = Array.isArray(sub.hackathons) ? sub.hackathons[0] : sub.hackathons;
            const ongoing = isOngoing(sub);
            const statusLabel = getStatusLabel(sub);

            return (
              <div
                key={sub.id}
                className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-background/30 p-5 transition hover:border-border/80 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-accent font-semibold px-2 py-0.5 rounded bg-accent/10">
                      {hackathon?.name || "Unknown Hackathon"}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        ongoing
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold tracking-tight text-foreground">
                    {sub.project_name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">by {sub.team_name}</p>

                  <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                    {sub.description || "No description provided."}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                    {sub.github_url && (
                      <a
                        href={sub.github_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Github className="size-3" /> GitHub
                      </a>
                    )}
                    {sub.demo_url && (
                      <a
                        href={sub.demo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="size-3" /> Live Demo
                      </a>
                    )}
                    {sub.video_url && (
                      <a
                        href={sub.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Video className="size-3" /> Video
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-border flex items-center justify-between">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    Payout: {truncateAddr(sub.payout_address)}
                  </div>

                  {ongoing ? (
                    <button
                      onClick={() => {
                        setEditingSubmission(sub);
                        setDialogOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <Edit3 className="size-3" /> Edit Project
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground italic">
                      Locked
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingSubmission && (
        <EditSubmissionDialog
          submission={editingSubmission}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingSubmission(null);
          }}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}
