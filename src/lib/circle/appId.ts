/**
 * Circle User-Controlled Wallets App ID (public configurator UUID).
 * Production always uses the Live/mainnet Configurator App ID.
 */
const LIVE_APP_ID = "4fc62765-6bbc-537c-9645-2648e481b3b0";
const SANDBOX_APP_ID = "c8a87945-e317-5b75-8845-e61e78586fe3";

export function circleAppId(): string {
  const fromEnv = (import.meta.env.VITE_CIRCLE_APP_ID as string | undefined)?.trim();
  if (!fromEnv || fromEnv === SANDBOX_APP_ID || fromEnv.toLowerCase().includes("test")) {
    return LIVE_APP_ID;
  }
  return fromEnv;
}
