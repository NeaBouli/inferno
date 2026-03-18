// commands/roadmap.js — /roadmap
const { Markup } = require('telegraf');

async function roadmapCommand(ctx) {
  const reply = `🗺 *Inferno (\$IFR) — Roadmap*
━━━━━━━━━━━━━━━━━━━━━

✅ *Phase 1 — Foundation (abgeschlossen)*
• 14 Contracts deployed & verifiziert
• 578 Tests, 91% Branch Coverage
• Governance, Vesting, Lock, Burn
• Sepolia Testnet vollständig

🔄 *Phase 2 — Launch (aktuell)*
• Ownership Transfer (Treasury/Community)
• Proposal #0 Execution
• Multisig 3-of-5 (Gnosis Safe)
• BootstrapVault Mainnet
• Uniswap V2 LP Pairing

❌ *Phase 3 — Growth*
• Builder Ecosystem & Creator Rewards
• SDK & API
• WalletConnect Integration
• CoinGecko / CMC Listing

❌ *Phase 4 — Decentralization*
• DAO Governance
• Community-geführte Proposals

❌ *Phase 5 — Scale*
• Bug Bounty Programm
• Ecosystem Fund

📖 [Roadmap Wiki](https://ifrunit.tech/wiki/roadmap.html)`;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Roadmap Details', 'https://ifrunit.tech/wiki/roadmap.html')],
  ]));
}

module.exports = roadmapCommand;
