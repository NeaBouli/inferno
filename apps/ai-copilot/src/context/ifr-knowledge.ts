const BOOTSTRAP_END = new Date("2026-06-05T00:00:00Z").getTime();

function getBootstrapStatus(): string {
  const now = Date.now();
  if (now < BOOTSTRAP_END) {
    const days = Math.ceil((BOOTSTRAP_END - now) / 86400000);
    return `NOW ACTIVE — Bootstrap is LIVE since 07.03.2026. Ends June 5, 2026 (${days} days remaining). Contribute at ifrunit.tech/wiki/bootstrap.html`;
  } else {
    return `ENDED — Bootstrap closed June 5, 2026. IFR is now on Uniswap.`;
  }
}

export function getIFRKnowledge() {
  return {
    contracts: {
      token: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
      ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
      partnerVault: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D",
      governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
      burnReserve: "0xaA1496133B6c274190A2113410B501C5802b6fCF",
      buybackVault: "0x670D293e3D65f96171c10DdC8d88B96b0570F812",
      feeRouter: "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",
      vesting: "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271",
      liquidityReserve: "0xdc0309804803b3A105154f6073061E3185018f64",
      network: "Ethereum Mainnet (Chain ID: 1)",
      decimals: 9
    },
    tokenomics: {
      genesisSupply: "1,000,000,000 IFR",
      currentSupply: "997,673,879.091903855 IFR at block 25812380 (decreasing — 2,326,120.908096145 IFR burned from genesis)",
      burnPerTransfer: "2.5% permanent",
      poolFee: "1.0%",
      totalFee: "3.5%",
      maxFee: "5.0% (hard cap)",
      partnerPool: "40M IFR (4%)"
    },
    exchangeFeePolicy: {
      decision: "Approved on 26 August 2026 at 00:17 MET by a 4-1 vote of the five-member Core Developer and Keyholder Council.",
      scope: "Transfers where an officially verified and on-chain fee-exempt CEX operational address is sender or recipient bypass the full 3.5% fee: no 2.0% sender burn, no 0.5% recipient burn and no 1.0% pool fee.",
      currentStatus: "No CEX address is currently fee-exempt on-chain. Policy approval is not the same as address activation.",
      activation: "Each address requires official exchange verification, proof of control, a public TreasurySafe 3-of-5 Governance proposal, the 48-hour timelock and execution.",
      internalTrading: "Internal CEX trades are off-chain ledger entries and do not invoke the IFR token contract.",
      uniswap: "The IFR/WETH Uniswap V2 pair is fee-exempt under Proposal #15; the Uniswap V2 router is not. Pair swaps bypass the IFR token fee, while normal AMM price impact and execution slippage still apply.",
      policy: "https://ifrunit.tech/EXCHANGE_FEE_EXEMPTION_POLICY.md"
    },
    aiCopilot: {
      premiumThreshold: "Lock >=1,000 IFR in IFRLock",
      premiumBenefit: "IFR lockers unlock Premium Copilot guidance. After wallet connection and lock verification, the assistant can communicate more personally because it can use wallet balance, lock status, tier, and on-chain context instead of only generic documentation.",
      safety: "The assistant never needs private keys or seed phrases. Lock verification is read from on-chain state."
    },
    web3Access: {
      primaryUrl: "https://web3.ifrunit.tech/",
      purpose: "Web3 is the lightweight user execution surface for IFR. Simple users should connect wallets and perform live user actions there instead of being routed into Wiki transaction pages.",
      userActions: [
        "connect wallet",
        "buy IFR",
        "add IFR to wallet",
        "check IFR balance",
        "check CommitmentVault lock state",
        "use the simple refundable IFRLock access lock or unlock all IFRLock funds",
        "lock IFR in CommitmentVault",
        "unlock matured CommitmentVault tranches",
        "create or increase LendingVault offers",
        "withdraw unlent IFR",
        "browse LendingVault offers, borrow when on-chain pricing is active, repay loans, or top up collateral",
        "track the live GeckoTerminal pool"
      ],
      roleRouting: {
        users: "Keep users on Web3 for execution flows.",
        builders: "Route builders to Wiki documentation for integration details, business onboarding, and ecosystem context.",
        developers: "Route developers to Wiki documentation for contracts, integration guide, and wallet/contract guide.",
        community: "Route deeper community/research users to Wiki governance, signer expansion, and transparency pages."
      },
      wikiRoutes: {
        builders: ["https://ifrunit.tech/wiki/integration.html", "https://ifrunit.tech/wiki/business-onboarding.html", "https://ifrunit.tech/wiki/ecosystem.html"],
        developers: ["https://ifrunit.tech/wiki/contracts.html", "https://ifrunit.tech/wiki/integration.html", "https://ifrunit.tech/wiki/wallet-guide.html"],
        community: ["https://ifrunit.tech/wiki/governance.html", "https://ifrunit.tech/wiki/community-signer-expansion.html", "https://ifrunit.tech/wiki/transparency.html"]
      },
      importantDistinction: "CommitmentVault and LendingVault Wiki pages are documentation/reference pages. Current user-facing Lock IFR and Create offer execution is intended to happen on Web3."
    },
    benefitsNetwork: {
      primaryUrl: "https://shop.ifrunit.tech/",
      status: "Live installable customer and seller PWA",
      customerActions: [
        "connect an external Ethereum wallet",
        "check ETH, IFR and IFRLock state",
        "lock or unlock IFR through the simple IFRLock access flow",
        "discover public seller offers, filter by a seller-published city, region or Online service area, and preview eligibility",
        "create and share an opaque short-lived customer pass from shop.ifrunit.tech/#customer-pass, then complete checkout in the original tab",
        "scan a seller-issued checkout QR with camera, local image, or proof-link fallback",
        "review and sign a short-lived one-time customer proof",
        "sign an explicit read-only request to load only that wallet's verified My benefits history across devices"
      ],
      sellerActions: [
        "create and manage a public seller profile with an optional broad city, region or Online service area, never a street address",
        "manage products, services and benefit rules",
        "delegate expiring checkout-operator wallets",
        "create a short-lived checkout QR bound to one rule",
        "see approved or rejected and redeem an approval once",
        "review protected recent sessions and masked local CSV"
      ],
      security: "Customer-initiated flow: the pass is created from shop.ifrunit.tech/#customer-pass and its QR contains only an opaque, short-lived shop.ifrunit.tech/p/:passId URL; it exposes no wallet, lock, signature, control token, rule, or internal session ID. The seller selects one exact rule, and the customer confirms the exact seller, product, discount, and IFRLock threshold in the original tab before one-time redeem. Seller-issued flow remains compatible and uses a short-lived shop.ifrunit.tech/r/:sessionId URL. Authoritative seller, rule, nonce, expiry, signature, and lock state stay server-side. Public proof-link polling is non-cacheable and never returns the recovered customer address, exact lock amount, or detailed rejection reason. The signing customer receives their own details in the direct attest response; seller operational details remain owner-wallet protected. Camera and selected QR images are decoded locally. My benefits uses a separate single-use read-only signature and a ten-minute access token held only in browser memory; it cannot move tokens and returns only the signer's history. The app never asks for a seed phrase or private key.",
      rewards: "The verified seller reward foundation is fail-closed. PartnerVault rewards are not active for an unregistered seller and require governance registration plus an authorized reward caller.",
      docs: "https://ifrunit.tech/wiki/business-onboarding.html"
    },
    partnerRewards: {
      rewardBps: 1500,
      policyTarget: "10-20%",
      hardBounds: "5-25%",
      annualCap: "4M IFR default",
      annualBounds: "1-10M IFR",
      vesting: "6-12 months"
    },
    governance: {
      timelockDelay: "48 hours",
      owner: "TreasurySafe 3-of-5 (since 20.03.2026)",
      guardian: "Deployer EOA — can cancel proposals",
      noInstantChanges: true,
      daoPhase: "Full DAO transition remains planned; current governance is TreasurySafe 3-of-5 plus the 48-hour timelock",
      multisig: "3-of-5 on all Safes (Treasury, Community, LP Reserve) — 5 signers: A.K./M.G./A.M./Y.K./A.P.",
      communitySignerExpansion: "Planned after community voting is live. This is the multisig signer distribution process. Preferred path: keep 3-of-5 now, expand to 4-of-7 using a mixed model (3 core/protocol, 2 contributor/builder, 2 community-elected), then consider 5-of-9 only after one stable term. Selection is not pure whale voting and not pure random selection; it requires eligibility, public nomination, community vote, security review, rotation, and emergency replacement rules. Full plan: https://ifrunit.tech/wiki/community-signer-expansion.html",
      proposals: "#0,#4-#9,#11,#12,#15,#16 executed; #1-#3,#10 cancelled.",
      nextPlanned: "No claim that seller rewards are active: PartnerVault registration and an authorized reward caller require separate governance execution.",
      feeExempt: "Deployer, TreasurySafe, CommunitySafe, CommitmentVault, LendingVault and LP Token are active fee exemptions.",
      vaultInvariantMonitoring: "A read-only four-hour Mainnet monitor fails closed if CommitmentVault or LendingVault loses feeExempt status or liquid custody falls below accounting. CommitmentVault balance is checked against totalLocked. LendingVault balance is checked against totalAvailable; totalLent is a separate borrower-held receivable. At block 25900438 both vaults were fee-exempt and exactly covered. V2 balance-diff accounting and runtime guards remain future work."
    },
    reputation: {
      positioning: "IFR is a utility-first, community-driven ERC-20 protocol built around lock-to-access use cases, builder integrations, lending/locking flows, open-source code, and on-chain transparency. It should not be described as a pure speculation token.",
      trustSignals: "Community Fair Launch; no presale, no VC, no private sale; no post-deploy mint function; open-source repository; verified Mainnet contracts; public wiki; live transparency pages; documented safes, governance, locks, lending, and LP status.",
      marketStatus: "IFR/WETH is live on Uniswap V2 and GeckoTerminal. A standalone CoinGecko coin listing is not yet confirmed.",
      pendingReviews: "Etherscan reports Neutral. MetaMask contract-metadata PR #1858 remains open for maintainer/code-owner approval. Project owner reports a Blockbit/external no-risk confirmation; public reference is pending, so do not call it a formal third-party audit until it is linkable.",
      wiki: "https://ifrunit.tech/wiki/reputation.html"
    },
    builderRegistry: {
      mainnet: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
      sepolia: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
      owner: "Governance (TreasurySafe 3-of-5)",
      deployed: "20.03.2026",
      tests: "27/27 passing",
      railwayEndpoints: "GET /api/builders/count, GET /api/builders/check/:address",
      builders: "Legacy off-chain directory entries include StealthX, K-9 Academy, Vendetta, NEXUS GR and ORIGO. Mainnet BuilderRegistry currently has 0 registered and 0 active builders."
    },
    phase3: {
      commitmentVault: {
        status: "DEPLOYED — Mainnet 04.04.2026, feeExempt active",
        address: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
        description: "Irrevocable tranche lock until its condition is met. TIME_ONLY is operational; price, time+price and time OR price fail closed while Mainnet priceOracle is the zero address.",
        contributorConfig: "C1/C2/C3 use TIME_ONLY tranches; total Mainnet CommitmentVault balance was 47,952,476.871794375 IFR at block 25900438.",
        autoUnlock: "30 days after condition met — anyone can call, tokens always go to original wallet",
        tests: "46/46 passing",
        wiki: "https://ifrunit.tech/wiki/commitment-vault.html",
        apiEndpoints: "GET /api/commitment/tranches/:address, GET /api/commitment/status/:address, GET /api/commitment/p0, GET /api/commitment/leaderboard"
      },
      lendingVault: {
        status: "DEPLOYED — Mainnet 04.04.2026, feeExempt active; guided self-service lender offer UI live",
        address: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
        description: "Lenders follow a guided 1-5 flow: connect MetaMask, choose amount, approve IFR if needed, createOffer(amount), then verify live market status. Approval alone is not an offer; createOffer is required before borrower and market views show liquidity.",
        interestRate: "2% to 25% based on utilization",
        collateral: "V1 parameters: 200% initial; checkHealth emits a warning below 150%; an external caller may liquidate below 120%. V1 has no enforced 48-hour grace period.",
        currentMainnetState: "Three offers provide 52,155,440.952845656 IFR, with 0 IFR lent. Borrowing is intentionally disabled because ifrPriceWei is 0.",
        tests: "56/56 passing",
        wiki: "https://ifrunit.tech/wiki/lending-vault.html",
        apiEndpoints: "GET /api/lending/stats, GET /api/lending/offers, GET /api/lending/loans/:address, GET /api/lending/health/:loanId, GET /api/lending/lender/:address"
      },
      lpStrategy: {
        description: "Phased LP addition — NOT all 400M at once. Wait for price appreciation = 100M x more efficient.",
        milestones: "M1: Pool 1 ETH → +50M IFR. M2: Pool 5 ETH → +100M IFR. M3: Sept 2026 LiqRes unlock.",
        wiki: "https://ifrunit.tech/wiki/lp-strategy.html"
      },
      buybackController: {
        status: "DEPLOYED — Mainnet 14.04.2026; governance wiring completed through Proposals #13 and #14",
        address: "0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c",
        description: "Governance-wired controller for guarded distribution. Permissionless execute() remains subject to its on-chain balance threshold and cooldown.",
        tests: "50/50 passing"
      },
      ecosystemWiki: "https://ifrunit.tech/wiki/ecosystem.html"
    },
    phase5: {
      integrationBuilder: {
        url: "https://ifrunit.tech/builder.html",
        description: "Generate IFR integration code in 60 seconds. Contract + SDK + deploy guide.",
        features: [
          "Amount slider (100-10k IFR)",
          "Hard Lock / Balance toggle",
          "Tier System (Basic/Premium/Pro)",
          "Security Score (0-100, SAFE/MEDIUM/RISKY)",
          "Contract code generation",
          "SDK snippet (local repository package; npm publication pending)",
          "Deploy guide (Sepolia → BuilderRegistry → Mainnet)"
        ]
      },
      sdk: {
        package: "ifr-sdk",
        version: "0.2.0",
        availability: "Local repository package; npm publication pending",
        install: "From the Inferno repository root: npm install --install-links ./apps/sdk",
        methods: "checkAccess(), getTier(), getBalance(), getLockedBalance(), isBuilder(), getTotalSupply()",
        restApi: "GET https://copilot-api.ifrunit.tech/api/ifr/check?wallet=0x...&required=1000"
      },
      contractLibrary: {
        path: "contracts/library/",
        modules: [
          "BaseAccessModule — minimal balance check (RISKY)",
          "HardLockModule — time-bound lock 7-365 days (SAFE)",
          "TierModule — Tier 1/2/3: 500/2k/10k IFR",
          "CooldownModule — anti-gaming 24h default",
          "IFRBuilderVault — all modules combined (recommended)"
        ],
        tests: "45/45 passing"
      },
      tiers: {
        tier1: "≥500 IFR → Basic Access",
        tier2: "≥2,000 IFR → Premium",
        tier3: "≥10,000 IFR → Pro / Full Access",
        note: "Uses locked balance (not wallet balance) for tier calculation"
      },
      securityScoring: {
        maxScore: 100,
        categories: "Hard Lock (30), Cooldown (20), Tier System (15), Min Amount (20), On-Chain Check (15)",
        levels: "≥80 SAFE, ≥50 MEDIUM, <50 RISKY"
      },
      apiEndpoints: {
        builderGenerate: "POST /api/builder/generate — generate contract + SDK from JSON config",
        ifrCheck: "GET https://copilot-api.ifrunit.tech/api/ifr/check?wallet=0x...&required=1000 — access check + tier"
      }
    },
    tiers: {
      tier1: { minIFR: 500,   level: "Basic" },
      tier2: { minIFR: 2000,  level: "Premium" },
      tier3: { minIFR: 10000, level: "Pro" }
    },
    bootstrap: {
      status: getBootstrapStatus(),
      phase: "ENDED — Bootstrap closed 05.06.2026 23:51 UTC. finalise() executed. IFR is live on Uniswap V2.",
      currentState: "Bootstrap FINALIZED. finalise() TX: 0x949848bdd09f4c867a2593afffb0137c7db2c1457d8a8f5ff4428f8ecce69c5f (Block 25254575). 100M IFR + 0.030 ETH paired as Uniswap V2 LP; 100M IFR reserved for contributor claims. Team.Finance was disabled on Mainnet. LP remains in BootstrapVaultV3, which exposes no LP withdrawal function.",
      startDate: "07.03.2026 (on-chain startTime) — ENDED 05.06.2026",
      endDate: "05.06.2026 23:51 UTC (finalise() executed on-chain)",
      vault: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
      funded: "200M IFR (funded March 11, 2026 via Plan B)",
      totalETHRaised: "0.030 ETH (finalized)",
      lpToken: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
      finaliseTx: "0x949848bdd09f4c867a2593afffb0137c7db2c1457d8a8f5ff4428f8ecce69c5f",
      finaliseBlock: 25254575,
      uniswapLink: "https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
      minContribution: "0.01 ETH",
      maxContribution: "2 ETH per wallet",
      mechanism: "Pro-rata IFR distribution — no fixed price, community-driven",
      lpLock: "Mainnet Team.Finance disabled; LP retained in BootstrapVaultV3 with no LP withdrawal function",
      securityReview: "Internal review March 2026: 11/14 secure, 3/14 low risk, 0 critical",
      url: "https://ifrunit.tech/wiki/bootstrap.html"
    },
    links: {
      github: "https://github.com/NeaBouli/inferno",
      website: "https://ifrunit.tech",
      wiki: "https://ifrunit.tech/wiki/",
      etherscan: "https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B"
    },
    bootstrapSafetyPlan: {
      problem: "Pool may start with very low ETH. " +
        "Currently 0.01 ETH = ~$20 depth. " +
        "99% of pool IFR buyable for ~$2,000.",
      layer1: {
        name: "CommitmentVault",
        description: "Contributors lock IFR claims " +
          "in 10 tranches (P0x2 to P0x5000). " +
          "No dump until milestones reached.",
        status: "Contributor 1: committed ✅"
      },
      layer2: {
        name: "LendingVault",
        description: "Contributors can offer IFR. Borrowing is disabled while ifrPriceWei is 0. " +
          "If a future borrower acquires IFR externally for repayment that can create market demand, " +
          "but V1 liquidation only distributes ETH collateral and performs no Uniswap purchase.",
        result: "No guaranteed buy pressure from V1 liquidation"
      },
      layer3: {
        name: "LP Reserve Safe",
        description: "400.6M IFR in Gnosis 3-of-5. " +
          "Added at milestones ONLY. " +
          "M1: pool 1 ETH → +50M IFR. " +
          "M2: pool 5 ETH → +100M IFR.",
        address: "0x5D93E7919a71d725054e31017eCA86B026F86C04"
      },
      p0Formula: "P0 = Total ETH raised / 100M. " +
        "IMMUTABLE after set in CommitmentVault.",
      currentStatus: {
        ethRaised: "0.030 ETH (finalized — Bootstrap ENDED 05.06.2026)",
        endDate: "2026-06-05",
        contributors: "C1/C2/C3 CommitmentVault locks and three LendingVault offers completed",
        lpToken: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
        proposal15: "setFeeExempt(LP Token, true) — executed 08.06.2026"
      }
    },
    safety: {
      neverAsk: ["seed phrase", "private key", "mnemonic", "secret recovery"],
      alwaysWarn: "Never share your seed phrase or private key with anyone - including this assistant."
    }
  };
}

// Static export for backwards compatibility
export const IFR_KNOWLEDGE = getIFRKnowledge();
