const BOOTSTRAP_START = new Date("2026-03-07T00:00:00Z").getTime();
const BOOTSTRAP_END   = new Date("2026-06-05T00:00:00Z").getTime();

function getBootstrapStatus(): string {
  const now = Date.now();
  if (now < BOOTSTRAP_START) {
    const days = Math.ceil((BOOTSTRAP_START - now) / 86400000);
    return `NOT YET ACTIVE — opens March 7, 2026 (in ${days} days)`;
  } else if (now < BOOTSTRAP_END) {
    const days = Math.ceil((BOOTSTRAP_END - now) / 86400000);
    return `ACTIVE — Bootstrap is OPEN. Ends June 5, 2026 (${days} days remaining). Contribute at ifrunit.tech/wiki/bootstrap.html`;
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
      currentSupply: "~998,500,000 IFR (decreasing — ~1.5M burned)",
      burnPerTransfer: "2.5% permanent",
      poolFee: "1.0%",
      totalFee: "3.5%",
      maxFee: "5.0% (hard cap)",
      partnerPool: "40M IFR (4%)"
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
      daoPhase: "Phase 4 (planned)",
      multisig: "3-of-5 on all Safes (Treasury, Community, LP Reserve) — 5 signers: A.K./M.G./A.M./Y.K./A.P.",
      proposals: "11 total: #0,#4-#9 executed, #1-#3,#10 cancelled. 0 open proposals.",
      nextPlanned: "#11 Uniswap Pool feeExempt (after Bootstrap finalise()), #12 set P0 in CommitmentVault",
      feeExempt: "Deployer, TreasurySafe, CommunitySafe — all active since 18.03.2026"
    },
    builderRegistry: {
      mainnet: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
      sepolia: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
      owner: "Governance (TreasurySafe 3-of-5)",
      deployed: "20.03.2026",
      tests: "27/27 passing",
      railwayEndpoints: "GET /api/builders/count, GET /api/builders/check/:address"
    },
    phase3: {
      commitmentVault: {
        status: "planned — Phase 3 (after Bootstrap ends June 2026)",
        description: "Irrevocable token lock until self-chosen condition met. 4 types: time, price, time+price, time OR price.",
        contributorConfig: "10 tranches x 10M IFR, P0x2 to P0x5000",
        autoUnlock: "30 days after condition met — anyone can call, tokens always go to original wallet",
        wiki: "https://ifrunit.tech/wiki/commitment-vault.html"
      },
      lendingVault: {
        status: "planned — Phase 3",
        description: "Lend locked IFR to builders against ETH collateral. Earn ETH interest. Creates buy pressure via repayments.",
        interestRate: "2% to 25% based on utilization",
        collateral: "200% initial, 150% margin call, 120% liquidation",
        wiki: "https://ifrunit.tech/wiki/lending-vault.html"
      },
      lpStrategy: {
        description: "Phased LP addition — NOT all 400M at once. Wait for price appreciation = 100M x more efficient.",
        milestones: "M1: Pool 1 ETH → +50M IFR. M2: Pool 5 ETH → +100M IFR. M3: Sept 2026 LiqRes unlock.",
        wiki: "https://ifrunit.tech/wiki/lp-strategy.html"
      },
      buybackController: {
        status: "planned — Phase 3+",
        description: "Automated fee distribution from FeeRouterV1 to BuybackVault + BurnReserve"
      },
      ecosystemWiki: "https://ifrunit.tech/wiki/ecosystem.html"
    },
    tiers: {
      bronze:   { minIFR: 1000,  discount: "5%" },
      silver:   { minIFR: 2500,  discount: "10%" },
      gold:     { minIFR: 5000,  discount: "15%" },
      platinum: { minIFR: 10000, discount: "20%" }
    },
    bootstrap: {
      status: getBootstrapStatus(),
      startDate: "March 7, 2026 (on-chain startTime)",
      endDate: "June 5, 2026 (on-chain endTime)",
      vault: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
      funded: "200M IFR (funded March 11, 2026 via Plan B)",
      minContribution: "0.01 ETH",
      maxContribution: "2 ETH per wallet",
      mechanism: "Pro-rata IFR distribution — no fixed price, community-driven",
      lpLock: "12 months via Team.Finance",
      refund: "30-day grace period after end — permissionless refund if not finalized",
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
        description: "Locked IFR earns ETH yield. " +
          "Every loan repayment = IFR bought. " +
          "Every default = collateral buys IFR.",
        result: "Guaranteed organic buy pressure"
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
        ethRaised: "0.01 ETH (1 contributor)",
        endDate: "2026-06-05",
        contributor1: "Committed to CommitmentVault ✅"
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
