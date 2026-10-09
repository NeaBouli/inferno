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
- [ ] Agreement to follow this onboarding guide and its exclusion criteria (there is no separate terms document)

### Exclusion Criteria

- Gambling, tobacco, weapons
- Businesses without a physical/digital location
- Already blocked/reported entities

## Step 2: Technical Setup

### Option A: Hosted Solution (recommended)
1. Open seller mode at `https://shop.ifrunit.tech` and connect the owner wallet
2. Create the public seller profile and keep its Business ID
3. Add products or services and configure at least one active IFRLock benefit rule
4. Authorize expiring checkout-operator wallets for cashier devices when needed
5. Bookmark the seller scanner URL on each point-of-sale device

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

### The Recommended Customer-Presented Flow (4 Steps)

1. **Customer creates** an opaque, short-lived pass in IFR Benefits
2. **Seller scans** the pass, selects the exact active rule, and signs with the owner or authorized checkout-operator wallet
3. **Customer reviews and signs** the exact checkout proof (seller, product, discount, required IFRLock amount) in the original browser tab
4. **Seller sees** `REDEEMED` or `REJECTED`: the customer proof redeems the checkout once when the
   signature matches the claimed wallet, the fresh IFRLock read is eligible and the seller who
   opened the checkout is still authorized; there is no separate seller redeem step

The compatible seller-issued QR flow remains available. It is also short-lived and the checkout is
only redeemed by the customer's signed proof. A failed or ineligible proof leaves the checkout open.

IFR does not enforce per-customer redemption limits, because the backend stores no customer
identity. Rules with a non-zero daily or monthly limit are refused; a business that needs such
limits enforces them in its own systems.

### What Cashier Staff Does NOT Need

- No crypto knowledge
- No handling of customer wallets, tokens, seed phrases, or private keys
- The checkout device does require the business owner wallet or an active checkout-operator wallet for protected seller actions
- No understanding of blockchain
- No internet banking access

## Step 5: Go-Live Checklist

- [ ] businessId created and verified
- [ ] Scanner URL bookmarked on smartphone/tablet
- [ ] Test pass completed with a known locked customer wallet
- [ ] Cashier staff briefed (5-minute training)
- [ ] Discount configured in POS/register
- [ ] IFR Builder badge placed on website/storefront
- [ ] Entry in IFR Builder Directory confirmed

## Step 6: Ongoing Operations

### Monthly Checks:
- Scanner URL and checkout-operator access still active?
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
The next fresh verification returns `REJECTED` when the current IFRLock balance is below the
selected rule threshold. The service fails closed when it cannot obtain a fresh on-chain result.

**Can we choose which tier we accept?**
Yes — each business independently configures tier and discount.

**What customer data is processed?**
The short-lived pass QR contains no wallet, lock amount, signature, control token, rule, or
internal session ID. The customer's wallet address is checked within the proof request (signature,
fresh IFRLock read, self-redemption check) and is not stored: the backend keeps no customer wallet
address, hash of it, signature, lock or balance amount, or customer history. It does keep a
merchant checkout record (random checkout ID, shop, offer terms, status, timestamps, lock source,
self-redemption flag and the seller wallet that opened it) plus seller-side audit events, so
checkouts are not anonymous. This data-minimizing design is not a legal compliance guarantee; each
operator remains responsible for its applicable privacy and retention obligations.

---
*As of: July 2026 | Version 2.0*
