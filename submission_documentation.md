# Ignites Submission Documentation: JurixAI ⚖️

This document contains the submission details for **JurixAI** for the Circle Ignites program.

---

## 1. Project Title

**JuriXAI: Autonomous Agentic Hackathon Judging & Escrow Protocol**

---

## 2. Description

JuriXAI is an autonomous, on-chain hackathon management and evaluation protocol. It eliminates the standard bottlenecks of traditional hackathons—subjective judging, evaluation fatigue, coordination delays, and slow, manual prize disbursements—by replacing human judges with a panel of specialized, deterministic AI agents and utilizing Circle Smart Accounts (SCA) alongside secure smart-contract escrows.

### Core Value Propositions:

- **Objectivity & Consistency:** A panel of 4 specialized AI agents evaluate projects on deterministic parameters (temperature 0.0) based on code execution, product value, originality, and completeness of shipping.
- **Economic Cycle (Agent Incentives):** Micro-payments in USDC are sent directly to the EVM wallets of the scoring agents on-chain, aligning the cost of compute with project complexity.
- **Atomic Disbursements:** Organizers deploy hackathons and fund them in one transaction. Winning payouts are triggered and distributed automatically in a single atomic smart contract call based on host-defined splits (e.g., 50/30/20).
- **Seamless Onboarding:** Circle Smart Accounts allow email OTP login and set up secure wallets without requiring private key management.

---

## 3. Track

**AI Agents & Developer Infrastructure** (Alternative: **DeFi & Payments**)

---

## 4. Circle Account Email

`ezinneagwu21@gmail.com`

---

## 5. Products Used

- **Circle Smart Accounts (SCA):** Used to generate ERC-4337 smart-contract wallets for both organizers and developers. This handles PIN-challenge authentication, secure transaction signing, and balance withdrawals.
- **Circle User-Controlled Wallets SDK / API:** Integrates the cross-origin iframe security model and email OTP authentication for frictionless Web3 onboarding.
- **Circle Programmable Wallets:** Used on the backend to facilitate wallet listings, balance queries, and transaction setups.
- **USDC Stablecoin Integration:** All economic actions (escrow funding, developer prize payouts, and agent workload fees) are denominated and paid in USDC stablecoin on Arc Network.

---

## 6. Working MVP

- **Production Domain URL:** [https://www.jurixai.xyz](https://www.jurixai.xyz)
- **Local Port Details:** Accessible locally on `http://localhost:3000` via Vite + React.
- **Smart Contract Deployment:**
  - **Arc Mainnet Escrow Contract:** [`0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5`](https://explorer.arc.io/address/0x95cdf46917ffcB741BD3214eD59a8cF02AF47ae5)

---

## 7. Architecture Diagram

```mermaid
graph TD
    subgraph Frontend (React + TanStack)
        U[User / Host / Builder] -->|Email OTP / PIN| CircleSDK[Circle Web SDK / Iframe]
        U -->|Submit Project / Create Hackathon| Dashboard[JuriXAI App Dashboard]
    end

    subgraph Backend Services
        Dashboard -->|Manage Hackathons & Submissions| DB[(Supabase Database)]
        Dashboard -->|Escrow Funding / PIN Challenge| CircleUCW[Circle User-Controlled Wallets API]
        Cron[Vercel Cron Job] -->|Every 10 Mins / Deadline Checks| JudgeEngine[Autonomous AI Judging Engine]
    end

    subgraph AI Layer
        JudgeEngine -->|API Call| RouterAI[0G AI Router / GPT-5.6 Sol]
        RouterAI -->|deterministic evaluation / temp 0| Vex[Vex: Code Quality Agent]
        RouterAI -->|deterministic evaluation / temp 0| Kael[Kael: Product Value Agent]
        RouterAI -->|deterministic evaluation / temp 0| Oryn[Oryn: Innovation Agent]
        RouterAI -->|deterministic evaluation / temp 0| Zera[Zera: Delivery & Docs Agent]
    end

    subgraph Blockchain Layer (Arc L1 Testnet)
        CircleUCW -->|Initiate Tx| EscrowContract[JuriXEscrow Smart Contract]
        JudgeEngine -->|On-Chain Micropayment| AgentWallets[AI Agents' EVM Wallets]
        EscrowContract -->|Atomically Disburse Prizes| WinnerWallets[Winners' Web3 Wallets]
    end
```

---

## 8. Documentation

### 8.1 Setup and Installation

To run the platform locally, follow these steps:

```bash
# 1. Clone the repository and install dependencies
pnpm install

# 2. Start the local server
npm run dev

# 3. Access the dashboard
# Open http://localhost:3000 in your browser
```

### 8.2 API Endpoints

- `/api/judge`: The main repository quality audit endpoint. It evaluates GitHub repositories using JuriXAI's 4-agent judging panel. When called (e.g. via `curl`), it returns the full audit results as JSON, prints a beautiful, human-readable ASCII report directly to the server terminal, and includes this text report in the JSON response under the `report` key for terminal-based clients.
- `/api/judge-deadlines`: Cron trigger endpoint (runs every 10 minutes) that checks for past-deadline hackathons, triggers LLM analysis, saves scores, pays agents, and prepares payouts.

### 8.3 Autonomous Workload Fee Algorithm

To compensate judging agents for compute and gas costs, they receive a dynamically calculated USDC fee:
$$\text{Fee (USDC)} = 0.0002 + (\text{Description Length} + \text{Rationale Length}) \times 0.000001$$

- **0.0002 USDC Base Fee:** Covers database overhead, Web3 transaction fees, and general connection logic.
- **0.000001 USDC / character:** Dynamically scales to the text input length (project description) and agent output length (detailed rationale).

### 8.4 Evaluation Rubric & Flag Penalties

Agents will raise flags if deliverables are missing, automatically reducing score:

- `missing_repo`: Raised by Vex (Code Judge) if no GitHub link exists. Autoreduces score to 1.00.
- `weak_readme`: Raised by Zera (Delivery Judge) if README is sparse or default. Penalizes score by 3.0 points.
- `missing_demo`: Raised by Kael (Product Judge) if no demo URL is included. Penalizes score by 4.0 points.

---

## 9. Product Feedback (Circle SDK/APIs)

1.  **Third-Party Cookie Dependency:** Because Circle's secure wallet SDK renders cross-origin iframes (`w3s.circle.com`) to write keys to storage, browsers that block third-party cookies by default (Brave, Safari, and strict Chrome configurations) fail during PIN and registration challenges. Emitting developer-friendly error codes or providing an alternative fallback flow would improve the UX.
2.  **Silent SDK Hanging on Out-of-Order Calls:** If developers execute a wallet operation (e.g. `createWallet`) before the user has generated a PIN challenge, the SDK hangs silently without returning a rejection or error. Explicit exception messages would drastically improve debugging times.
3.  **Unified Paymaster (Gas Sponsorship) Portal:** While programmable wallets make transactions easy, setting up gas sponsorships on new L2 networks or custom EVM chains (like Arc Network) remains complex. A unified portal inside the Circle developer console to fund/sponsor gas on any EVM chain would accelerate deployment.
4.  **Local SDK Simulation:** Adding a mocking library or local sandbox environment for testing the PIN challenge-response flow offline (without making live sandbox API calls) would allow developers to run robust CI/CD pipelines.
