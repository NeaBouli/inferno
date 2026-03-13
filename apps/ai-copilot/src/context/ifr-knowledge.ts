const BOOTSTRAP_START = new Date("2026-04-17T00:00:00Z").getTime();
const BOOTSTRAP_END   = new Date("2026-07-15T00:00:00Z").getTime();

function getBootstrapStatus(): string {
  const now = Date.now();
  if (now < BOOTSTRAP_START) {
    const days = Math.ceil((BOOTSTRAP_START - now) / 86400000);
    return `NOT YET ACTIVE — opens April 17, 2026 (in ${days} days)`;
  } else if (now < BOOTSTRAP_END) {
    const days = Math.ceil((BOOTSTRAP_END - now) / 86400000);
    return `ACTIVE — Bootstrap is OPEN. Ends July 15, 2026 (${days} days remaining). Contribute at ifrunit.tech/wiki/bootstrap.html`;
  } else {
    return `ENDED — Bootstrap closed July 15, 2026. IFR is now on Uniswap.`;
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
      totalSupply: "1,000,000,000 IFR",
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
      guardian: "can cancel proposals",
      noInstantChanges: true,
      daoPhase: "Phase 4 (planned)"
    },
    tiers: {
      bronze:   { minIFR: 1000,  discount: "5%" },
      silver:   { minIFR: 2500,  discount: "10%" },
      gold:     { minIFR: 5000,  discount: "15%" },
      platinum: { minIFR: 10000, discount: "20%" }
    },
    bootstrap: {
      status: getBootstrapStatus(),
      startDate: "April 17, 2026",
      endDate: "July 15, 2026 (90 days)",
      vault: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
      funded: "194.75M IFR (funded March 11, 2026 via Plan B)",
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
    safety: {
      neverAsk: ["seed phrase", "private key", "mnemonic", "secret recovery"],
      alwaysWarn: "Never share your seed phrase or private key with anyone - including this assistant."
    }
  };
}

// Static export for backwards compatibility
export const IFR_KNOWLEDGE = getIFRKnowledge();
