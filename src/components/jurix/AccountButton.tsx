import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Copy, Fingerprint, LogOut, Mail } from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWallet } from "@/lib/circle/useWallet";
import { emailLoginStatus } from "@/lib/circle/userWallet.server";
import {
  explainCircleLoginError,
  isEmailLoginConfigured,
  userWalletChain,
  warmCircleLogin,
} from "@/lib/circle/userWallet";
import { isWalletConfigured, walletChain } from "@/lib/circle/wallet";
import { truncateAddr } from "@/lib/format";
import logoUrl from "@/assets/jurixai-logo.png";

type Step = "choose" | "email" | "passkey";

export function AccountButton() {
  const { wallet, busy, error, loginEmail, signOut, signUp, logIn } = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      try {
        const status = await emailLoginStatus();
        if (cancelled) return;
        setServerReady(status.configured);
        setServerError(
          status.configured
            ? null
            : status.apiKeyKind === "TEST"
              ? "Server is still using Circle TEST keys. Production login needs the LIVE API key."
              : "Circle email login is not fully configured on the server. Add CIRCLE_API_KEY (LIVE) in Vercel.",
        );
      } catch (err) {
        if (cancelled) return;
        setServerReady(false);
        setServerError(err instanceof Error ? err.message : "Failed to verify Circle login setup.");
      }
    })();

    // Start Circle's iframe + deviceId while the user types their email.
    // Chrome drops the click "user gesture" if we wait until after the click.
    void warmCircleLogin();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── Connected: wallet chip + sign out ───────────────────────────────────
  if (wallet) {
    return (
      <div className="flex items-center gap-2">
        <Link
          to="/profile"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          Dashboard
        </Link>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(wallet.address);
            toast.success("Wallet address copied", { description: wallet.address });
          }}
          title={`${wallet.identifier} · ${wallet.chain}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:border-input transition-colors"
        >
          {truncateAddr(wallet.address)}
          <Copy className="size-3" />
        </button>
        <button
          onClick={() => {
            signOut();
            router.invalidate();
            router.navigate({ to: "/" });
          }}
          title="Sign out"
          className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    );
  }

  const configured = isEmailLoginConfigured() && serverReady !== false;
  const setupMessage = !isEmailLoginConfigured()
    ? "Wallet login is not configured in this environment yet (VITE_CIRCLE_APP_ID missing)."
    : serverError;
  const passkeySetupMessage = !isWalletConfigured()
    ? "Passkey wallet setup is missing VITE_CIRCLE_CLIENT_KEY and VITE_CIRCLE_CLIENT_URL."
    : null;
  const title =
    step === "choose"
      ? "Log in to JuriXAI"
      : step === "email"
        ? "Continue with email"
        : "Continue with passkey";
  const subtitle =
    step === "choose"
      ? "Create your account, get a personal wallet, and unlock your profile dashboard."
      : step === "email"
        ? "We'll email you a one-time code, create your wallet, and open your profile dashboard."
        : "Use a passkey on this device to create your wallet and account.";

  function reset() {
    setStep("choose");
    setEmail("");
    setHandle("");
    setServerError(null);
    setServerReady(null);
  }

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="rounded-lg px-4 py-2 bg-accent text-accent-foreground text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
      >
        Create account
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-6" onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt="JuriXAI" className="size-10 object-contain mb-3" />
            <DialogTitle className="text-xl font-bold tracking-tight">{title}</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          </div>

          {step === "email" && setupMessage && (
            <p className="mt-4 rounded-lg bg-warn/10 text-warn text-xs p-3">{setupMessage}</p>
          )}
          {step === "passkey" && passkeySetupMessage && (
            <p className="mt-4 rounded-lg bg-warn/10 text-warn text-xs p-3">{passkeySetupMessage}</p>
          )}

          {/* Step: choose method */}
          {step === "choose" && (
            <div className="mt-5 space-y-3">
              <button
                onClick={() => setStep("email")}
                className="w-full flex items-center gap-3 rounded-xl border border-border p-3.5 text-left hover:border-input hover:bg-muted/50 transition-colors"
              >
                <span className="size-10 shrink-0 rounded-lg bg-accent/10 grid place-items-center text-accent">
                  <Mail className="size-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">Email</span>
                  <span className="block text-xs text-muted-foreground">
                    One-time code to your inbox. Profile + wallet created on first login.
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground shrink-0" />
              </button>

              <button
                disabled
                className="w-full flex items-center gap-3 rounded-xl border border-border p-3.5 text-left opacity-60 cursor-not-allowed"
              >
                <span className="size-10 shrink-0 rounded-lg bg-accent/10 grid place-items-center text-accent">
                  <Fingerprint className="size-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold flex items-center gap-1.5">
                    Passkey
                    <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Coming Soon
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Face ID or fingerprint wallet login.
                  </span>
                </span>
              </button>
            </div>
          )}

          {/* Step: email */}
          {step === "email" && (
            <div className="mt-5 space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                autoFocus
                className="w-full rounded-lg border border-border px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {error && <p className="text-warn text-xs">{error}</p>}
              <button
                disabled={busy || !email.trim() || !configured || serverReady === null}
                onClick={async () => {
                  const tid = toast.loading("Sending verification email...");
                  try {
                    await loginEmail(email.trim().toLowerCase(), (status: string) => {
                      if (status === "awaiting_otp") {
                        // Close our dialog so Chrome can focus Circle's OTP iframe.
                        setOpen(false);
                        toast.loading("Email sent! Enter the verification code in the popup...", { id: tid });
                      } else if (status === "verifying_wallet") {
                        toast.loading("Connecting wallet session...", { id: tid });
                      } else if (status === "awaiting_pin") {
                        toast.loading("PIN keypad loading... Please wait for the keyboard to pop up in the secure window.", { id: tid });
                      } else if (status === "polling_address") {
                        toast.loading("Security PIN set! Creating and deploying smart wallet on-chain (please wait, up to 20s)...", { id: tid });
                      }
                    });
                    toast.success("Wallet ready", {
                      id: tid,
                      description: "Your Circle wallet is connected.",
                    });
                    window.location.href = "/profile";
                  } catch (err) {
                    const msg = explainCircleLoginError(err);
                    toast.error("Login failed", {
                      id: tid,
                      description: msg,
                      duration: 16000,
                    });
                  }
                }}
                className="w-full rounded-lg bg-accent text-accent-foreground px-4 py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
              >
                {busy
                  ? "Sending code…"
                  : serverReady === null
                    ? "Checking setup…"
                    : "Email me a code"}
              </button>
              <div className="flex justify-between items-center pt-1">
                <button
                  onClick={() => setStep("choose")}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3" /> Back
                </button>
              </div>
            </div>
          )}

          {step === "passkey" && (
            <div className="mt-5 space-y-3">
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="choose-a-handle"
                autoFocus
                className="w-full rounded-lg border border-border px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {error && <p className="text-warn text-xs">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={busy || !handle.trim() || !isWalletConfigured()}
                  onClick={async () => {
                    try {
                      await signUp(handle.trim());
                      setOpen(false);
                      toast.success("Passkey wallet created");
                      window.location.href = "/profile";
                    } catch {
                      /* error shown inline */
                    }
                  }}
                  className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {busy ? "Working…" : "Create"}
                </button>
                <button
                  disabled={busy || !handle.trim() || !isWalletConfigured()}
                  onClick={async () => {
                    try {
                      await logIn(handle.trim());
                      setOpen(false);
                      toast.success("Passkey wallet connected");
                      window.location.href = "/profile";
                    } catch {
                      /* error shown inline */
                    }
                  }}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {busy ? "Working…" : "Sign in"}
                </button>
              </div>
              <button
                onClick={() => setStep("choose")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> Back
              </button>
            </div>
          )}

          <p className="mt-5 text-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {step === "passkey" ? `Passkey on ${walletChain()}` : `Gasless on ${userWalletChain()}`} ·
            {" "}Secured by Circle
          </p>

          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
            Chrome on a computer: if login gets stuck, allow cookies for Circle. Open Settings → Privacy
            and security → Third-party cookies → Allow (or add{" "}
            <span className="font-mono">[*.]circle.com</span>), then refresh this page.
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
