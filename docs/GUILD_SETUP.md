# Guild.xyz Setup — IFR Community

**URL:** https://guild.xyz/create
**Date prepared:** 16.03.2026

---

## Guild Name

IFR Protocol Community

## Description

Token-gated community for $IFR holders. Lock >=1,000 IFR to join. Verified on-chain via IFRLock contract.

---

## Role: IFR Holder

**Requirement:**
- Type: ERC-20 Balance
- Chain: Ethereum Mainnet
- Token: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` (InfernoToken)
- Min Balance: 1000 (= 1000 IFR, 9 decimals: 1000000000000)

---

## Role: IFR Locker (Premium)

**Requirement:**
- Type: Contract Call (read function)
- Chain: Ethereum Mainnet
- Contract: `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` (IFRLock)
- Function: `isLocked(address, uint256)`
- Params: `[userAddress, 1000000000000]` (1000 IFR with 9 decimals)
- Expected return: `true`

**What this verifies:**
The user has locked at least 1,000 IFR in the IFRLock contract. This is the same on-chain check used by all builder products in the IFR ecosystem.

---

## Platforms to Connect

- Telegram: @IFR_token group (community chat)
- Discord: (optional, if created later)

---

## Links to Add in Guild Profile

| Platform | URL |
|----------|-----|
| Website | https://ifrunit.tech |
| Twitter/X | https://x.com/IFRtoken |
| GitHub | https://github.com/NeaBouli/inferno |
| Telegram | https://t.me/IFR_token |
| Juicebox | https://juicebox.money/v5/eth:79 |
| Bootstrap | https://ifrunit.tech/wiki/bootstrap.html |

---

## After Setup

1. Copy Guild URL
2. Add to landing page (docs/index.html footer)
3. Add to wiki sidebar or bootstrap.html
4. Post Farcaster Post #4 (FARCASTER_POSTS.md)
5. Announce in Telegram channel
