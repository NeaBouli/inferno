export const IFR_KNOWLEDGE = {
  contracts: {
    token: "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
    ifrLock: "0x0Cab0A9440643128540222acC6eF5028736675d3",
    partnerVault: "0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39",
    governance: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
    network: "Sepolia Testnet (Chain ID: 11155111)",
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
  links: {
    github: "https://github.com/NeaBouli/inferno",
    website: "https://neabouli.github.io/inferno/",
    wiki: "https://neabouli.github.io/inferno/wiki/",
    etherscan: "https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4"
  },
  safety: {
    neverAsk: ["seed phrase", "private key", "mnemonic", "secret recovery"],
    alwaysWarn: "Never share your seed phrase or private key with anyone - including this assistant."
  }
};
