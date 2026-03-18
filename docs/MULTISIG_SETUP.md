# Inferno ($IFR) — Multisig Setup Guide

## Why Multisig?
On testnet: single EOA (deployer) as Governance Owner — acceptable for testing.
On mainnet: MUST be multisig. Otherwise: single point of failure.
Goal: no single key can control the protocol.

## Recommended Structure

### Owner Multisig (Governance)
- **Type:** Gnosis Safe (https://safe.global)
- **Threshold:** 4-of-7 (4 signers must approve)
- **Signer Profiles:**
  - 2x founders/core team (hardware wallets)
  - 2x trusted community members
  - 2x builder representatives
  - 1x reserve signer (cold storage)

### Guardian Multisig (Emergency Cancel)
- **Type:** Gnosis Safe
- **Threshold:** TBD (separate Safe)
- **Purpose:** Only cancel() — cannot propose or execute
- **Signer Profiles:** Core team + 1 independent auditor

---

## Gnosis Safe Setup — Step by Step

### Phase 1: 2-of-4 Multisig (completed 14.03.2026, superseded by 3-of-5)

#### Prerequisites

#### Wallet Requirements per Signer Type

| Slot | Role | Wallet Type | Rationale |
|------|------|------------|-----------|
| Founder 1+2 | Core Team | Hardware Wallet (Ledger/Trezor) | Mandatory — highest risk |
| Community 1+2 | Elected | Hardware wallet recommended, MetaMask acceptable | |
| Builder 1+2 | Accredited | MetaMask/WalletConnect acceptable | |
| Reserve | Cold Storage | Air-gapped hardware wallet | Mandatory |

> For testnet phase, hot wallets (MetaMask) are OK for all slots.
> For mainnet: founder slots MUST use hardware wallets.

- Sepolia ETH on all 3 wallets for gas
- Separate devices for each signer

#### Setup
1. https://app.safe.global → "Create new Safe"
2. Network: Ethereum (Mainnet) or Sepolia (Test)
3. Add owners: 3 hardware wallet addresses
4. Threshold: 3 (3-of-5) — current active configuration
5. Note the Safe address

#### Ownership Transfer (after Safe Setup)

Scripts ready:
```bash
npx hardhat run scripts/propose-ownership-transfer.js --network sepolia
```

For mainnet, adjust:
- Target address: Safe multisig address (not Timelock!)
- First: LiquidityReserve, BuybackVault, BurnReserve → Safe
- Then: Token Owner → Safe (via Governance)

### Phase 2: 3-of-5 Multisig (Q4 2026)

Expansion by 2 community representatives:
1. Snapshot vote: community elects 2 representatives
2. Safe Settings → Add Owners
3. Threshold: 3-of-5

### Phase 3: 4-of-7 Multisig (Q1 2027)

Full decentralization:
- 2 founders (hardware wallet)
- 2 community (Snapshot elected)
- 2 builder representatives (first accredited builders)
- 1 reserve (cold storage)
- Threshold: 4-of-7

### Guardian Multisig

Separate Safe for emergency cancel only:
- 1 founder
- 1 independent security reviewer
- 1 community representative
- Threshold: TBD
- Only function: `governance.cancel(proposalId)`

---

## Security Checklist

- [ ] Each signer has their own hardware wallet (mainnet)
- [ ] Seed phrases stored separately and securely
- [ ] Test transaction before ownership transfer
- [ ] Safe address verified on Etherscan
- [ ] Backup process documented
- [ ] Recovery plan: at least 2 signers always reachable
- [ ] Signer rotation planned every 12 months

---

## Gnosis Safe — Proposal Flow

1. Safe UI → "New Transaction" → "Contract Interaction"
2. Target: Governance contract address
3. ABI: paste Governance ABI
4. Function: `propose(address target, bytes calldata)`
5. Copy parameters from Governance Dashboard calldata generator
6. Submit → other signers confirm → after 48h: Execute

---

## Costs (Ethereum Mainnet)

| Action | Estimated Cost |
|--------|---------------|
| Safe Deployment | ~0.01 ETH (~$35) |
| Each Transaction | ~0.002-0.005 ETH |
| Ownership Transfer | ~0.005 ETH |
| **Budget per Safe** | **min. 0.1 ETH** |

> Sepolia: Free (testnet ETH via faucet)

---

## Important Notes

- **Separation:** Owner multisig and guardian multisig MUST be different Safes
- **Hardware:** Founder slots always require hardware wallets on mainnet
- **Rotation:** Signer rotation recommended every 12 months
- **Backup:** Document all Safe settings
- **Recovery:** Keep at least 2 signers always reachable

---
*As of: March 2026 | Version 2.0*
