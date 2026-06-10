# StealthX × IFR Integration Spec

## Concept

StealthX users unlock premium app features by locking IFR tokens.
IFR acts as the utility token for access control within the StealthX app —
no IFR is transferred or burned, only locked on-chain.

## Technical Approach

The IFRLock contract (already deployed on Ethereum Mainnet) provides a minimal
on-chain lock-and-check mechanism:

| Property | Value |
|----------|-------|
| Contract | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |
| Function | `isLocked(address wallet) view returns (bool)` |
| Function | `lockedBalance(address wallet) view returns (uint256)` |
| Minimum lock | Recommended: 1,000 IFR (governance-adjustable) |
| Lock duration | User-defined (CommitmentVault: 30 days min) |

The integration is read-only from the StealthX side — no contract deployment,
no admin keys, no IFR custody. The app simply calls `isLocked()` or checks
`lockedBalance() >= threshold` to gate features.

## Integration Steps

### Phase 1 — Backend Gate (minimal)

1. StealthX backend adds RPC read on feature unlock:
   ```js
   const ifrLock = new ethers.Contract(
     '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb',
     ['function lockedBalance(address) view returns (uint256)'],
     provider
   );
   const locked = await ifrLock.lockedBalance(userWallet);
   const isPremium = locked.gte(ethers.utils.parseUnits('1000', 9));
   ```

2. User flow:
   - User buys IFR on Uniswap V2
   - User locks ≥1,000 IFR via ifrunit.tech/wallet or CommitmentVault UI
   - StealthX checks `lockedBalance(wallet) >= 1000 IFR` on feature request
   - Gate opens — no periodic polling needed (check per feature request)

### Phase 2 — Frontend Badge

- Add "IFR Premium" badge in StealthX UI when lock condition is met
- Deep-link to `https://ifrunit.tech/wallet` for users who want to lock

### Phase 3 — Telegram Bot Integration

- Telegram bot verification can check IFR lock for exclusive StealthX topics
- Existing `/verify` command infrastructure can be extended

## Contract Addresses

| Contract | Mainnet |
|----------|---------|
| IFR Token | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |
| CommitmentVault | `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` |
| Uniswap V2 Pool | `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` |

## Minimum Lock Recommendation

| Tier | IFR Locked | Access |
|------|-----------|--------|
| Basic | ≥ 100 IFR | Ad-free mode |
| Premium | ≥ 1,000 IFR | All premium features |
| Pro | ≥ 10,000 IFR | Early access + priority support |

Thresholds are governance-adjustable via IFR Governance. Initial values are
recommendations — StealthX team can choose their own thresholds.

## Advantages

- No IFR transfer needed — user keeps their tokens
- No server-side custody or admin key
- Trustless: on-chain verifiable by anyone
- User retains IFR value (can unlock after lock period ends)
- IFR demand increases → price support for the ecosystem

## Next Steps

- [ ] Brief StealthX team on IFR lock mechanism
- [ ] Agree on minimum lock threshold (recommendation: 1,000 IFR)
- [ ] StealthX backend: add `lockedBalance()` RPC check
- [ ] StealthX frontend: add "IFR Premium" badge + lock CTA
- [ ] Telegram: extend `/verify` for StealthX-specific topic access
- [ ] Announcement after integration live
