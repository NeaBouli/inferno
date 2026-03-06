# Business Onboarding SOP — IFR Benefits Network

Standard Operating Procedure for onboarding new builder businesses
into the IFR Benefits Network.

## Overview
The IFR Benefits Network enables businesses to offer exclusive
discounts and benefits to IFR token holders — verified through
on-chain lock status, without requiring crypto knowledge from cashier staff.

## Step 1: Initial Contact & Eligibility

### Minimum Requirements
- [ ] Legal business with business registration
- [ ] Willingness to set IFR lock requirements for customers (min. 1,000 IFR)
- [ ] Technical basis: smartphone or tablet for QR scanner
- [ ] Acceptance of the IFR Builder Terms of Service

### Exclusion Criteria
- Gambling, tobacco, weapons
- Businesses without a physical/digital location
- Already blocked/reported entities

## Step 2: Technical Setup

### Option A: Hosted Solution (recommended)
1. Business receives access to the IFR Builder Dashboard
2. Registration: name, logo, discount %, required lock
3. QR code is generated (unique businessId)
4. Cashier staff opens scanner URL on smartphone
5. Done — no technical knowledge required

### Option B: Self-Hosted (for developers)
1. Clone Docker image: `git clone https://github.com/NeaBouli/inferno`
2. `cd apps/benefits-network && cp .env.example .env`
3. Configure RPC URL + contract addresses
4. `docker-compose up -d`
5. Create your own businessId via Admin API

## Step 3: Tier Configuration

| Tier | Minimum Lock | Recommended Discount |
|------|-------------|---------------------|
| Bronze | 1,000 IFR | 5–10% |
| Silver | 2,500 IFR | 10–15% |
| Gold | 5,000 IFR | 15–20% |
| Platinum | 10,000 IFR | 20–25% |

Business chooses: which tier(s) to accept.
Recommendation: offer at least Bronze (lowest barrier for customers).

## Step 4: Cashier Staff Training (5 Minutes)

### The QR Flow (3 Steps):
1. **Business opens** scanner URL on tablet/smartphone
2. **Customer scans** QR code with their wallet app
3. **Screen shows**: APPROVED (green) or DENIED (red)
4. **Optional**: click "Redeem" → status REDEEMED

### What Cashier Staff Does NOT Need:
- No crypto knowledge
- No MetaMask/wallet
- No understanding of blockchain
- No internet banking access

## Step 5: Go-Live Checklist

- [ ] businessId created and verified
- [ ] QR code saved on smartphone/tablet
- [ ] Test scan performed with own wallet
- [ ] Cashier staff briefed (5-minute training)
- [ ] Discount configured in POS/register
- [ ] IFR Builder badge placed on website/storefront
- [ ] Entry in IFR Builder Directory confirmed

## Step 6: Ongoing Operations

### Monthly Checks:
- QR code still active? (test scan)
- Discount conditions still appropriate?
- New tier options available?

### Support Channels:
- Technical: GitHub Issues → https://github.com/NeaBouli/inferno/issues
- General: Builder documentation → docs/PARTNER_INTEGRATION_SPEC.md

## FAQ for Businesses

**Does the program cost anything?**
No — the IFR Benefits Network is free for builders.
Businesses only pay for their own hosting (Option B).

**What if a customer removes their lock?**
The next scan automatically shows DENIED — no manual intervention required.

**Can we choose which tier we accept?**
Yes — each business independently configures tier and discount.

**Is the customer verification GDPR-compliant?**
Yes — no personal data is stored.
Only: wallet address (public on-chain), lock status (public on-chain),
verification timestamp (temporary, 60s TTL).

---
*As of: March 2026 | Version 1.0*
