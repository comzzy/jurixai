import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createWallet, loginWallet, type CircleWallet } from "./wallet";
import { emailSignIn, explainCircleLoginError } from "./userWallet";
import {
  saveAccountProfile as saveAccountProfileServer,
} from "@/lib/account/profile.server";
import type { AccountProfile, SaveAccountProfileInput } from "@/lib/account/types";
import {
  clearWalletSession,
  getWalletSession,
  persistWalletSession,
} from "@/lib/account/session.server";

interface WalletContextValue {
  wallet: CircleWallet | null;
  profile: AccountProfile | null;
  busy: boolean;
  error: string | null;
  profileBusy: boolean;
  signUp: (username: string) => Promise<void>;
  logIn: (username: string) => Promise<void>;
  loginEmail: (email: string, onStatusUpdate?: (status: string) => void) => Promise<void>;
  saveProfile: (input: SaveAccountProfileInput) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<CircleWallet | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await getWalletSession();
        if (cancelled) return;
        setWallet(session.wallet);
        setProfile(session.profile);
      } catch {
        if (cancelled) return;
        setWallet(null);
        setProfile(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    setProfileBusy(true);
    try {
      const session = await getWalletSession();
      setWallet(session.wallet);
      setProfile(session.profile);
    } finally {
      setProfileBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const run = useCallback(
    async (fn: () => Promise<CircleWallet>) => {
      setBusy(true);
      setError(null);
      try {
        const nextWallet = await fn();
        const session = await persistWalletSession({
          data: {
            identifier: nextWallet.identifier,
            authMethod: nextWallet.authMethod,
            address: nextWallet.address,
            chain: nextWallet.chain,
          },
        });
        setWallet(session.wallet);
        setProfile(session.profile);
      } catch (e) {
        const msg = explainCircleLoginError(e instanceof Error ? e : "Wallet action failed");
        // Surface the real failure even if the modal has closed — the flow was
        // failing silently otherwise, which made it impossible to diagnose.
        // eslint-disable-next-line no-console
        console.error("[jurix wallet]", e);
        setError(msg);
        toast.error("Account/wallet error", { description: msg, duration: 12000 });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const signUp = useCallback((username: string) => run(() => createWallet(username)), [run]);
  const logIn = useCallback((username: string) => run(() => loginWallet(username)), [run]);
  const loginEmail = useCallback(
    (email: string, onStatusUpdate?: (status: string) => void) =>
      run(async () => {
        return emailSignIn(email, onStatusUpdate);
      }),
    [run],
  );
  const saveProfile = useCallback(
    async (input: SaveAccountProfileInput) => {
      if (!wallet) throw new Error("Sign in first.");
      setProfileBusy(true);
      setError(null);
      try {
        const next = await saveAccountProfileServer({
          data: {
            identifier: wallet.identifier,
            authMethod: wallet.authMethod,
            walletAddress: wallet.address,
            walletChain: wallet.chain,
            ...input,
          },
        });
        setProfile(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Profile update failed");
        throw e;
      } finally {
        setProfileBusy(false);
      }
    },
    [wallet],
  );
  const signOut = useCallback(() => {
    void clearWalletSession();
    setWallet(null);
    setProfile(null);
    setError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        profile,
        busy,
        error,
        profileBusy,
        signUp,
        logIn,
        loginEmail,
        saveProfile,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
