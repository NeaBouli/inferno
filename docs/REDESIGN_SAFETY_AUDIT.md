# Redesign Safety Audit — inferno-redesign.html vs docs/index.html
Date: 2026-06-10

---

## Summary

| Metric | Count |
|--------|-------|
| Functional elements inventoried in index.html | 32 |
| Present in redesign (same or equivalent) | 13 ✅ |
| Missing from redesign | 14 ❌ |
| Different implementation (review needed) | 5 ⚠️ |

**Verdict: NOT SAFE TO DEPLOY**

Critical blockers: wallet-core.js not loaded, ifr-state.js not loaded, live data API
feed absent, copilot iframe widget absent, "Buy IFR" Uniswap link absent, wallet
connect is a non-functional demo stub.

---

## Technical note: file format

`inferno-redesign.html` is a bundled/compiled single-file artifact (Canva or similar
design tool export). The actual HTML lives inside a
`<script type="__bundler/template">` block as a JSON-encoded string. JavaScript is
distributed across six UUID-keyed gzip-compressed bundles embedded in a
`<script type="__bundler/manifest">` block. All analysis below operates on the
decoded content.

---

## ✅ Present (same or equivalent)

1. **Contract addresses (15 contracts)** — all 15 production addresses present and
   correct in the bundled interactivity JS (`ee641d81-…`): InfernoToken
   (0x77e99917…), IFRLock (0x769928aB…), Governance (0xc43d48E7…), and all
   supporting contracts/Gnosis Safes.

2. **Copy-to-clipboard on contract addresses** — implemented in the bundled JS,
   with a toast notification.

3. **FAQ section** — 8 questions present in bundled JS, covering all critical
   topics (rug pull, lock mechanism, Bootstrap, distribution).

4. **Governance section** — `id="governance"` present with DAO description and
   timelock/multisig information.

5. **Roadmap section** — 5-phase roadmap with Phase 1 complete, Phase 2 in progress.

6. **Contracts section** — `id="contracts"` with dynamically rendered contract list.

7. **GitHub link** — `https://github.com/NeaBouli/inferno` present in nav CTA and footer.

8. **X/Twitter social link** — `https://x.com/IFRtoken` in footer.

9. **Ethers.js references** — present (7 occurrences) in template, used in FAQ and
   description contexts (isLocked pattern mentioned in Phase 3 section).

10. **IFRLock contract address** — correctly referenced.

11. **isLocked concept** — mentioned in protocol description and FAQ content.

12. **Uniswap V2 reference** — textual references to Uniswap V2 LP in architecture
    and tokenomics sections.

13. **"Connect Wallet" button** — nav CTA button `id="connect"` present.

---

## ❌ MISSING — Must be added before deploy

### CRITICAL

**C1. `wallet-core.js` not loaded**
- Production: `<script src="assets/wallet-core.js"></script>`
- Redesign: NOT present anywhere in template or bundled scripts.
- Impact: The entire wallet connection flow (MetaMask, account detection, balance
  reads, autoReconnect, event subscriptions) does not exist. The redesign's
  "Connect Wallet" button is wired to a mock handler that only shows a toast
  saying "Wallet connection — demo only". No real wallet connects.

**C2. `ifr-state.js` not loaded**
- Production: `<script src="assets/ifr-state.js"></script>`
- Redesign: NOT present.
- Impact: IFRState (loading ETH/IFR balances, isLocked1000 status) is never
  initialized. The wallet dropdown showing ETH balance, IFR balance, and lock
  status cannot function.

**C3. `ethers.js` CDN not loaded**
- Production: `<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js">` with unpkg fallback.
- Redesign: NOT loaded as a script tag. Ethers is referenced only in text/FAQ
  content, not as a runtime library.
- Impact: wallet-core.js and ifr-state.js (when added) would fail immediately
  since `ethers` global is undefined.

**C4. AI Copilot widget (iframe) absent**
- Production: Fixed-position FAB button (`id="ifr-btn"`) + sliding panel
  (`id="ifr-panel"`) with `<iframe src="https://copilot-api.ifrunit.tech">`.
  Full mobile-responsive layout, open/close logic, mobile panel close button.
- Redesign: Has a `id="copilot"` section with marketing copy ("IFR Copilot — an
  on-chain guide") and three feature cards, but NO iframe, NO FAB button,
  NO copilot-api.ifrunit.tech connection. The section is purely informational.
- Impact: Users cannot interact with the AI Copilot at all.

**C5. Live token data feed absent (`copilot-api.ifrunit.tech/api/ifr/…`)**
- Production: Full inline script block polling:
  - `GET https://copilot-api.ifrunit.tech/api/ifr/supply`
  - `GET https://copilot-api.ifrunit.tech/api/ifr/balances`
  - `GET https://copilot-api.ifrunit.tech/api/ifr/price`
  - Refreshes every 30 seconds, lazy-loaded on scroll.
  - Populates donut chart, legend, metrics panel, all `data-live-key` elements.
- Redesign: NO live API calls anywhere. No `data-live-key` attributes.
  No donut chart. All token stats are hardcoded/static.
- Impact: No live supply, burned, locked, price, or balance data is shown.

**C6. "Buy IFR" Uniswap link absent**
- Production: `https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  appears in the nav wallet dropdown and in the tokenomics section.
- Redesign: No direct Uniswap swap link with the IFR contract address.
  Only textual mentions of "Uniswap V2" without a buy link.
- Impact: Users have no direct path to buy IFR from the page.

**C7. Wallet connect functionality is non-functional (mock only)**
- Production: Full `lpConnect()` / `lpDisconnect()` / `lpUpdateUI()` / event
  subscription stack calling real `IFRWallet` and `IFRState` APIs.
- Redesign: The `#connect` click handler is:
  `connect.addEventListener("click", function(e) { e.preventDefault(); showToast("Wallet connection — demo only"); });`
  This is explicitly a demo/prototype stub.
- Impact: Zero real Web3 functionality.

### HIGH

**H1. Wallet dropdown (connected state) absent**
- Production: Full dropdown with address, ETH balance, IFR balance, lock status
  badge, Buy IFR button, Disconnect button.
- Redesign: No equivalent element; there is no connected/disconnected UI state.

**H2. WalletConnect info modal absent**
- Production: Modal explaining Phase 1 (MetaMask) / Phase 2 (WalletConnect QR)
  with phase status badges.
- Redesign: Not present.

**H3. LP / bootstrap vault status panel absent**
- Production: Live IFRLock stat (`data-live-key="ifrlock-stat"`), Bootstrap
  FINALIZED note with Uniswap LP link, all 17 contract wallet cards with live
  balances.
- Redesign: Static contract list only, no balance cards, no finalization status.

**H4. Bootstrap/wiki nav link absent**
- Production: Nav has `<a href="wiki/bootstrap.html">Bootstrap</a>` and several
  wiki deep-links (`wiki/lock-mechanism.html`, `wiki/transparency.html`, etc.)
- Redesign: No `wiki/` links anywhere.

**H5. `#dao-governance`, `#wizard`, `#copilot` nav anchors missing from nav**
- Production nav: About, Overview, Token, Ecosystem, Copilot, Arch, Security,
  FAQ, Roadmap, Gov, Bootstrap, Contracts.
- Redesign nav: Overview, How it works, Ecosystem, Tokenomics, Security,
  Governance, Contracts, FAQ. Missing: Copilot link, Bootstrap link, Arch link,
  Roadmap link missing from nav.

### MEDIUM

**M1. Animated hero banner (canvas-based) absent**
- Production: Three layered canvases (`ifr-c-parts`, `ifr-c-shock`, `ifr-c-title`),
  black hole void animation, Orbitron-font INFERNO title, fire ring, star field,
  teal aura, cyan rim/rays — full WebGL-style canvas animation.
- Redesign: Static photo masthead image with CSS fade mask. Visually very different.
- Impact: Visual/branding regression; not a functional blocker.

**M2. "Find your path" wizard section absent**
- Production: `<a href="#wizard">` link + interactive path-picker widget.
- Redesign: Not present.

**M3. Telegram links are placeholder `href="#"`**
- Production: `https://t.me/IFRtoken` and `https://t.me/IFR_token` in footer.
- Redesign footer: `<a href="#">Telegram</a>` — dead link.

---

## ⚠️ Different Implementation — Review needed

**D1. Copilot section — informational only vs. functional widget**
- Index: AI Copilot is a floating iframe widget accessible from any page position.
  The section `#copilot` links to the live chatbot.
- Redesign: Copilot section exists (`id="copilot"`) but is a marketing teaser with
  three feature cards (Customer/Builder/Developer mode). No interactive element.
- Review: Decide whether the redesign is intentionally moving to a "teaser →
  link" pattern or whether the iframe FAB must be re-added.

**D2. Wallet connect button behavior**
- Index: Orbitron-font "Connect" button triggers full MetaMask flow via wallet-core.js.
- Redesign: Plain "Connect Wallet" button shows demo-only toast.
- Review: Must be wired to wallet-core.js before deploy.

**D3. "Connect Wallet" replaced full nav wallet state management**
- Index: Two states — `#lp-header-connect-btn` (not connected) and
  `#lp-header-connected` div (connected, shows address + dropdown).
- Redesign: Single static button only.
- Review: Full state machine must be restored.

**D4. Nav items are fewer and renamed**
- Index: 12 nav items including Copilot, Bootstrap (link to wiki), Arch, Roadmap,
  Gov (anchor to #dao-governance).
- Redesign: 8 nav items. "Gov" goes to `#governance` (exists). Missing: Bootstrap,
  Arch, Copilot, Roadmap in nav. "Roadmap" and "Architecture" sections do exist
  in the page but have no nav entry.
- Review: Minor UX regression for section accessibility.

**D5. Footer social/resource links incomplete**
- Index footer: GitHub, X/Twitter, Telegram Announcements, Telegram Community,
  Documentation (wiki), Juicebox, Blog (paragraph.com), Etherscan, Governance,
  Contact (email).
- Redesign footer: GitHub, X/Twitter, Telegram (`#` placeholder), Governance
  (`#` placeholder), Press kit (`#` placeholder). Missing: Documentation/wiki,
  Juicebox, Blog, Etherscan direct link, contact email.
- Review: Complete before deploy.

---

## Critical Findings

### Finding 1 — CRITICAL: Zero real Web3 functionality
The redesign contains no working wallet integration. wallet-core.js, ifr-state.js,
and ethers.js are all absent. The "Connect Wallet" button is explicitly coded as a
demo stub. Deploying this would silently remove all wallet features from the live
production site.

### Finding 2 — CRITICAL: AI Copilot completely absent
The production page's most interactive feature — the floating copilot FAB that
opens a full iframe chat panel to `copilot-api.ifrunit.tech` — does not exist in
the redesign. The redesign has a static marketing section about the Copilot but
no functional widget.

### Finding 3 — CRITICAL: Live on-chain data feed removed
All real-time token supply, burned amount, locked IFR, and price feeds via
`copilot-api.ifrunit.tech/api/ifr/*` are absent. The donut chart, balance cards,
and all `data-live-key` elements do not exist in the redesign.

### Finding 4 — HIGH: "Buy IFR" conversion path missing
Users landing on the redesign have no direct path to buy IFR on Uniswap. The
production page shows a Buy IFR button in both the nav wallet dropdown and inline
in the contracts/tokenomics area.

### Finding 5 — HIGH: All wiki/ deep-links removed
The production page links extensively into the wiki documentation system
(`wiki/bootstrap.html`, `wiki/lock-mechanism.html`, `wiki/fair-launch.html`,
`wiki/transparency.html`, `wiki/wallet-guide.html`, etc.). None of these appear
in the redesign.

---

## Recommendation

**NOT SAFE TO DEPLOY**

The redesign is a high-quality visual prototype that correctly handles static
content (sections, copy, tokenomics, contracts, roadmap, FAQ) and has all contract
addresses correctly embedded. However it is missing every functional layer that
makes the production site interactive:

1. Add `<script src="assets/wallet-core.js"></script>` and
   `<script src="assets/ifr-state.js"></script>` (after ethers CDN).
2. Load ethers 5.7.2 from CDN with unpkg fallback.
3. Restore the full `lpConnect()` / `lpDisconnect()` / `lpUpdateUI()` wallet
   controller and the connected-state dropdown HTML.
4. Re-add the AI Copilot FAB button + panel + iframe pointing to
   `https://copilot-api.ifrunit.tech`.
5. Re-add the live data polling block (`/api/ifr/supply`, `/api/ifr/balances`,
   `/api/ifr/price`) and all `data-live-key` display elements.
6. Add the "Buy IFR" Uniswap link.
7. Fix placeholder `href="#"` Telegram links (use actual t.me URLs).
8. Restore wiki/ documentation links.
9. Add `<link rel="preconnect" href="https://copilot-api.ifrunit.tech">` to `<head>`.
10. Remove the `data-theme="light"` tweaks panel from the production build
    (design-tool artifact, not needed in production).

Items 1–6 are CRITICAL blockers. Items 7–10 are HIGH priority.
