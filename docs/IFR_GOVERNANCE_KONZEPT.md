# Complete Concept: IFR Native Governance via Telegram

**Title:** Integration of a two-chamber system for transparent, scalable, and token-weighted community governance directly in Telegram.
**Project:** Inferno Protocol ($IFR)
**Date:** 08.03.2026

---

## 1. Executive Summary

The goal is to govern the IFR community directly where it lives: in Telegram. A hybrid on-chain/off-chain governance system is created that respects IFR's burning characteristic (no transaction costs for voting) while providing maximum transparency and security.

The system consists of two separate but complementary chambers:

1. **The Council (Team Governance):** For strategic decisions and capital allocation.
2. **The Forum (Community Innovation):** For creative proposals with built-in economic spam protection.

---

## 2. High-Level Architecture

The architecture is divided into three layers: Presentation (Telegram), Logic (Backend/Bot), and Truth (Blockchain).

```
[TELEGRAM - UI LAYER]
------------------------------------------------------
| Channel @IFR_News    | Group @IFR_Council          |
| (Announcements)      | (Team + Bot only)           |
------------------------------------------------------
| Group @IFR_Forum     | Group @IFR_Vote             |
| (Anyone with Lock)   | (Voting only)               |
------------------------------------------------------
            |                           |
            | Bot reads/writes           | Bot triggers transactions
            v                           v
[BACKEND - BOT LAYER (Node.js)]
------------------------------------------------------
| - Wallet management (Mapping User <-> Wallet)      |
| - IFR Lock Contract queries (read-only)            |
| - Off-chain vote management (Reactions/Polls)       |
| - Aggregation & Merkle Tree generation              |
| - On-chain transaction execution (bot only)         |
------------------------------------------------------
            |                           |
            | Reads lock status          | Sends results/finalization
            v                           v
[BLOCKCHAIN - ON-CHAIN LAYER (Ethereum)]
------------------------------------------------------
| IFR CORE:                                          |
| - IFR Token Contract                               |
| - IFR Lock Contract <------------------------------+
|----------------------------------------------------|
| NEW CONTRACTS:                                     |
| - RatVoting.sol      (for team votes)              |
| - ForumVoting.sol    (for community proposals)     |
| - IFRSpamProtection.sol (manages the 10 IFR fee)  |
------------------------------------------------------
```

---

## 3. The Two Chambers in Detail

### Chamber 1: The Council (Team Governance)

- **Purpose:** Management of protocol parameters, treasury funds, and strategic partnerships.
- **Participants:** The dev team / multisig signers.
- **Proposal rights:** Team only.

**How it works:**

1. **Initiation:** A team member creates a proposal via `/council_proposal "Title" "Description" "Duration"`.
2. **Publication:** Bot posts the proposal in @IFR_Council (read-only for community). Discussion takes place in @IFR_Forum.
3. **Voting (Snapshot Model):** Only users with IFR-Lock may participate. Votes are off-chain, weighted by lock amount (1 IFR = 1 vote).
4. **Finalization & Anchoring:**
   - Bot aggregates weighted results
   - Bot creates Merkle Tree from all submitted votes
   - Bot sends a single on-chain transaction to `RatVoting.sol`: ProposalID + ForWeight + AgainstWeight + MerkleRoot
   - Every voter can prove that their vote was correctly included in the Merkle Tree

---

### Chamber 2: The Forum (Community Innovation)

- **Purpose:** Community brings ideas; the most popular ones proceed to a binding vote.
- **Participants:** Anyone with IFR-Lock.
- **Proposal rights:** Anyone — for a fee of **10 IFR** (spam protection).

**How it works:**

1. **Submission (Spam Protection):**
   - Member uses `/propose My Idea` in @IFR_Forum
   - Bot checks IFR-Lock and transfers 10 IFR to `IFRSpamProtection.sol`
   - Bot posts the idea as its own message

2. **Up/Down Voting Period (7 days):**
   - Community votes via reactions (thumbs up / thumbs down)
   - Bot weights each reaction by the voter's IFR-Lock amount
   - Automatic deletion: downvote share > 50% of total weight — idea fails, 10 IFR burned

3. **Ranking & Consensus Finding:**
   - Daily cron job calculates score (upvotes minus downvotes) of all active proposals
   - Top 3 proposals are posted daily in the Forum

4. **Consensus Phase (Binding Vote):**
   - Proposal stays 10 consecutive days in Top 3 — consensus phase begins
   - Bot creates EIP-712 compliant message
   - Eligible voters sign via `/sign 42 yes`
   - Bot collects signatures over 3 days

5. **Final Execution:**
   - Bot bundles signatures — single transaction to `ForumVoting.sol`
   - Contract verifies: signature valid? IFR-Lock sufficient at time of vote?
   - Result stored on-chain, permanently valid
   - Team uses on-chain result as directive for next steps

---

## 4. Bot Architecture ("The Glue")

A single bot serves both chambers with strict role separation.

**Core Components:**

| Component | Function |
|---|---|
| Wallet-Mapper | Encrypted DB: TelegramUserID ↔ EthereumAddress (one-time free signature) |
| IFR-Reader | Continuously reads IFR Lock Contract (Infura/Alchemy), caches lock amounts |
| Reaction-Tracker | Tracks every reaction with timestamp + lock weight of the user |
| Poll-Manager | Creates native Telegram polls for the Council, aggregates weighted results |
| Cron: Ranking Calculator | Runs daily, calculates top proposals |
| Cron: Consensus Starter | Checks if a proposal has been in Top 3 for 10 days |
| Cron: Finalizer | Sends collected votes on-chain after signature phase |
| Executor | Sole component with private key / multisig access for on-chain transactions |

---

## 5. New Smart Contracts

### RatVoting.sol
- Stores results of team votes (snapshot model)
- `finalizeProposal()` — bot-only, stores: ProposalID, ForWeight, AgainstWeight, MerkleRoot
- `verifyVote(proposalId, voterAddress, vote, weight, proof)` — view function that allows any voter to prove their vote was counted

### ForumVoting.sol
- Manages binding community votes (signed-vote model)
- `submitVotes(ProposalID, VoteMessage[] votes, bytes[] signatures)` — iterates over all votes, verifies signatures (ecrecover), queries IFR Lock Contract, stores final result

### IFRSpamProtection.sol
- Accepts 10 IFR fee for new proposals
- On successful consensus: 10 IFR refunded (incentive for quality proposals)
- On deletion (downvote > 50%): 10 IFR burned — deflationary
- Requires `approve()` from user before submission

---

## 6. User Journey

**New user "Max" discovers IFR:**

1. Max joins @IFR_News and sees announcements.
2. He wants to participate — joins @IFR_Forum.
3. Bot: *"Welcome! Connect your wallet with IFR-Lock. Send /connect."*
4. Max sends `/connect` — Bot sends Mini-App link — Max connects MetaMask, signs for free.
5. Bot: *"Connected! You have 5,000 IFR locked. You now have 5,000 votes."*
6. Max sees a team proposal in @IFR_Council (read-only), discusses in the Forum, votes via poll. His vote counts as 5,000.
7. Max has his own idea — `/propose "Treasury should fund 10k IFR for community event"` — Bot deposits 10 IFR — idea is posted and receives upvotes.
8. After 10 days in Top 3 — Bot DMs: *"Your proposal is in the consensus phase! Vote: /sign 42 yes"*
9. Max signs with wallet — Bot: *"Vote registered. Final result on-chain in 3 days at tx: 0x..."*

---

## 7. Conclusion & Value for the IFR Core Team

| Property | Description |
|---|---|
| Scalability | Thousands of users without high gas costs |
| Security | On-chain anchoring prevents manipulation |
| Economic Incentives | 10 IFR spam protection supports IFR deflation |
| Transparency | All steps documented in Telegram or verifiable on-chain |
| Professionalism | Clear separation of team governance and community innovation |

This system would be a globally unique integration of Telegram into a deflationary asset and could serve as a blueprint for other communities. The core team retains admin control over all security-relevant processes.

---

*As of: 08.03.2026 — IFR Governance Concept v1.0*
