# JuriXAI ⚖️

JuriXAI is an on-chain hackathon hosting platform built for the Lepton Agents Hackathon. It replaces human judges with a panel of AI agents, using USDC micropayments on **Arc Mainnet** to pay agents for evaluations and distribute prize pools to winners.

The platform uses Circle Smart Accounts (SCA) to provide developer and organizer wallets.

## Features
*   **AI Judges:** 4 specialized agent profiles (Technical Quality, Product Value, Originality, and Presentation) score submissions. Scoring is deterministic (temperature 0.0).
*   **Workload-based Fees & Agent Wallets:** Every AI agent has an individual EVM wallet. Agent workload fees are calculated dynamically based on the character length of the project details and their generated response (base fee of `0.0002 USDC` + `0.000001 USDC` per character). These fees are transferred from the escrow contract to the scoring agent's wallet address on-chain on every project evaluation.
*   **Dynamic Explorer Links:** Clickable Arcscan transaction links appear directly under each judge's score on the project page.
*   **On-Chain Escrow Smart Contract:** Hackathons require organizers to fund the prize pool and platform fee upon creation. The funds are sent to a secure **`JuriXEscrow`** smart contract on-chain. The contract instantly forwards the platform fees to the fee collector and locks the prize pool inside the contract.
*   **Automated Atomic Prize Payouts:** Once judging is closed (either manually by an admin or automatically when a deadline passes), the platform autonomously triggers the smart contract payout. The contract distributes the locked rewards atomically in a single contract call to the winners EVM addresses based on the configured split (e.g. 50/30/20) with no human in the loop.
*   **Circle Smart Accounts:** Login via email OTP and set up a PIN. Developers can withdraw their balance directly to Metamask or other external wallets by completing a PIN challenge.

## Environment Variables (.env)
Create a `.env` file in the root directory:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Circle
CIRCLE_API_KEY=your-circle-api-key
VITE_CIRCLE_APP_ID=your-circle-app-id
VITE_CIRCLE_CHAIN=ARC
CIRCLE_CHAIN=ARC
CIRCLE_ENV=production
# VITE_ARC_RPC_URL=https://rpc.mainnet.arc.io
# VITE_ARC_EXPLORER=https://explorer.arc.io
# VITE_ARC_CHAIN_ID=5042
VITE_ESCROW_CONTRACT_ADDRESS=0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5

# Session
JURIX_SESSION_SECRET=some-random-secret-key

# Operator (Escrow & Gas)
JURIX_OPERATOR_PRIVATE_KEY=your-evm-private-key
JURIX_FEE_COLLECTOR=your-evm-fee-collector-address

# LLM Configuration
JURIX_JUDGE_PROVIDER=openai_compat
JURIX_JUDGE_BASE_URL=https://router-api.0g.ai/v1
JURIX_JUDGE_API_KEY=your-ai-router-key
JURIX_JUDGE_MODEL=glm-5.1
```

## Smart Contract Escrow (JuriXEscrow)
The live escrow is **JuriXEscrow v2** on **Arc Mainnet** (chain ID `5042`):
[`0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5`](https://explorer.arc.io/address/0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5)

RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`. USDC (gas + prizes) is `0x3600000000000000000000000000000000000000`. Circle's wallet chain code is `ARC`.

The Solidity source is in `scripts/deploy-escrow-v2.ts`. Deploy scripts refuse mainnet unless the operator has native USDC and you pass `--allow-mainnet`. Testnet funds and the old testnet escrow do not move; staging can still set `CIRCLE_CHAIN=ARC-TESTNET`.

## Supabase Database Setup
Create a new SQL query in the Supabase Dashboard and run:

```sql
alter table public.judge_agents
  add column if not exists wallet_address text;

update public.judge_agents set wallet_address = '0xE6FC925Ff22e972F1D819b93b968Dc4B69ce9629' where slug = 'vex-01';
update public.judge_agents set wallet_address = '0x9F4d3272f88180154f1c97aCa3491f3Baa8EfFa1' where slug = 'kael-02';
update public.judge_agents set wallet_address = '0x126BD7Ca8268708e62fb778EeA5910855D13E73C' where slug = 'oryn-03';
update public.judge_agents set wallet_address = '0x1F996D3ecFAF4b3348451959d4f8fA8274686d53' where slug = 'zera-04';
```

## How to Run Locally
1. Install dependencies:
    ```bash
    pnpm install
    ```
2. Start the development server:
    ```bash
    npm run dev
    ```
3. Open `http://localhost:3000`.

## OKX.AI Reviewer Startup

OKX/Claude reviewer sessions must start without dangerous permission bypass flags when the runtime user is `root` or uses `sudo`. Claude CLI rejects options such as `--dangerously-skip-permissions` in privileged sessions, which prevents the review agent from starting and can make the service appear unresponsive.

Use the normal non-bypass startup path instead:

```bash
npm run build
npm run preview
```

For CLI smoke tests, also avoid bypass flags:

```bash
claude -p --permission-mode acceptEdits "Reply with the single word OK."
codex exec --sandbox workspace-write "Reply with the single word OK."
```

## MCP (Claude, Codex, Cursor, Grok)

Paste this:

```json
{
  "mcpServers": {
    "jurixai": {
      "url": "https://mcp.jurixai.xyz/mcp"
    }
  }
}
```

Hosted endpoint: https://mcp.jurixai.xyz/mcp (same app also serves https://www.jurixai.xyz/mcp). Local stdio package lives in `packages/mcp`.

## 🌐 Browser Compatibility Note (Chrome/Safari/Brave)
Circle login uses a secure window from `pw-auth.circle.com`. Chrome on a computer often blocks that window.
*   **Chrome (PC):** Allow the Circle popup when asked. If login still fails: `chrome://settings/cookies` → Sites allowed to use third-party cookies → Add `jurixai.xyz` and `www.jurixai.xyz` (the site you are on, not circle.com), then refresh. Incognito usually fails.
*   **Safari (PC):** Allow cookies for Circle, or use Chrome with the setting above.
*   **Brave:** Usually works. If login fails, allow cookies for `circle.com` in Shields.

## Quick Demo Flow
1. **Sign In:** Click "Sign In", input email, verify OTP, and set a PIN. This generates your Circle Smart Account (SCA).
2. **Host a Hackathon:** Go to `/create` (requires login). Set prize splits and details.
3. **Execute Payment:** Upon clicking "Deploy Hackathon", verify your smart account balance, execute the on-chain transfer directly to the smart contract escrow, and authorize it. The hackathon will be deployed and fully funded immediately.
4. **Submit:** Log in as a developer, submit a project, and the payout address is pre-filled from your wallet.
5. **Run Judging:** In the admin page (`/admin`), click "Run judging". This triggers LLM scoring and pays agent fees on-chain.
6. **Verify Payouts:** Under each score on the project detail page, click the green "Fee Paid" link to check the transaction on Arcscan.
7. **Automated Disbursement:** Once judging is triggered and completed, the platform instantly and automatically distributes rewards to the winners on-chain. The admin page also includes a manual "Disburse Prizes" button as a fallback if needed.
8. **Withdraw Winnings:** Winnings will show in the user's dashboard. Go to `/profile`, click "Withdraw", type recipient address and amount, enter PIN, and the funds are sent to your external wallet.

## Automated Autonomous Judging
The platform operates fully autonomously when hackathon deadlines pass:
*   **Cron Trigger Endpoint:** `/api/judge-deadlines` (accepts both `GET` and `POST` requests).
*   **Vercel Crons:** Configured in `vercel.json` to automatically invoke the endpoint every 10 minutes.
*   **Logic:** The endpoint triggers `runExpiredHackathons()`, which retrieves all `open` hackathons where the deadline is in the past, spins up the LLM evaluation runs, saves the scores, marks the hackathon closed, and immediately triggers the on-chain payout disbursement to the winners autonomously.

