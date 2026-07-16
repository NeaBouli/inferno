#!/usr/bin/env node

const { ethers } = require('ethers');

const baseUrl = (process.env.BENEFITS_BASE_URL || 'https://shop.ifrunit.tech').replace(/\/$/, '');
const mutate = process.env.MUTATE === 'true';
const cleanup = process.env.CLEANUP !== 'false';
const customerPrivateKey = process.env.CUSTOMER_PRIVATE_KEY || '';

function usage() {
  console.log(`IFR Benefits Network seller wallet smoke

Usage:
  node scripts/seller-wallet-smoke.js
  MUTATE=true node scripts/seller-wallet-smoke.js
  CUSTOMER_PRIVATE_KEY=0x... MUTATE=true node scripts/seller-wallet-smoke.js
  BENEFITS_BASE_URL=http://localhost:3001 MUTATE=true node scripts/seller-wallet-smoke.js

Defaults:
  BENEFITS_BASE_URL=${baseUrl}
  MUTATE=false
  CLEANUP=true

What it checks:
  - public health endpoint
  - server-issued seller auth messages
  - signed seller profile list
  - with MUTATE=true: create wallet-owned seller profile, reload it, create/list/delete a rule,
    create QR session, sign customer challenge, attest, redeem approved sessions,
    deactivate the seller profile

Seller keys are always throwaway and in-memory. CUSTOMER_PRIVATE_KEY is optional for testing
an actually locked customer wallet; it is never printed.`);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function fetchNoContent(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status !== 204) {
    const text = await response.text();
    throw new Error(`Expected HTTP 204 ${path}, got ${response.status}: ${text}`);
  }
}

async function signSellerAction(wallet, action, businessId) {
  const query = new URLSearchParams({ action, businessId });
  const challenge = await fetchJson(`/api/seller/auth-message?${query.toString()}`);
  const signature = await wallet.signMessage(challenge.message);
  return {
    walletAddress: wallet.address,
    signature,
    timestamp: challenge.timestamp,
  };
}

function sellerHeaders(auth) {
  return {
    'x-ifr-wallet': auth.walletAddress,
    'x-ifr-signature': auth.signature,
    'x-ifr-timestamp': auth.timestamp,
  };
}

async function expectHttpStatus(path, expectedStatus, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`Expected HTTP ${expectedStatus} ${path}, got ${response.status}: ${text}`);
  }
  return text;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const wallet = ethers.Wallet.createRandom();
  const customerWallet = customerPrivateKey ? new ethers.Wallet(customerPrivateKey) : ethers.Wallet.createRandom();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const businessName = `IFR Smoke Seller ${stamp}`;

  console.log('IFR Benefits seller wallet smoke');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mode: ${mutate ? 'MUTATE' : 'READ_ONLY'}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Customer wallet: ${customerWallet.address}${customerPrivateKey ? ' (env)' : ' (throwaway)'}`);

  const health = await fetchJson('/api/health');
  console.log(`Health: ${health.status} / chain ${health.chainId}`);

  const listAuth = await signSellerAction(wallet, 'business:list', 'seller');
  const initialList = await fetchJson('/api/seller/businesses', {
    headers: sellerHeaders(listAuth),
  });
  console.log(`Initial owned seller profiles: ${initialList.businesses.length}`);

  if (!mutate) {
    console.log('Read-only smoke complete. Set MUTATE=true to exercise create/reload/rule/delete.');
    return;
  }

  const createAuth = await signSellerAction(wallet, 'business:create', 'new');
  const business = await fetchJson('/api/seller/businesses', {
    method: 'POST',
    body: JSON.stringify({
      name: businessName,
      discountPercent: 12,
      requiredLockIFR: 1000,
      ttlSeconds: 300,
      tierLabel: 'Smoke',
      ownerAddress: wallet.address,
      signature: createAuth.signature,
      timestamp: createAuth.timestamp,
    }),
  });
  console.log(`Created seller profile: ${business.id}`);

  const reloadAuth = await signSellerAction(wallet, 'business:list', 'seller');
  const reloaded = await fetchJson('/api/seller/businesses', {
    headers: sellerHeaders(reloadAuth),
  });
  if (!reloaded.businesses.some((entry) => entry.id === business.id)) {
    throw new Error(`Created business ${business.id} was not returned by owner reload`);
  }
  console.log('Reload owned profiles: OK');

  const ruleAuth = await signSellerAction(wallet, 'rules:create', business.id);
  const rule = await fetchJson(`/api/seller/businesses/${business.id}/rules`, {
    method: 'POST',
    headers: sellerHeaders(ruleAuth),
    body: JSON.stringify({
      label: 'Smoke 12%',
      category: 'Test',
      productName: 'Smoke checkout benefit',
      discountPercent: 12,
      requiredLockIFR: 1000,
      ttlSeconds: 300,
      active: true,
    }),
  });
  console.log(`Created benefit rule: ${rule.id}`);

  const listRulesAuth = await signSellerAction(wallet, 'rules:list', business.id);
  const rules = await fetchJson(`/api/seller/businesses/${business.id}/rules`, {
    headers: sellerHeaders(listRulesAuth),
  });
  if (!rules.rules.some((entry) => entry.id === rule.id)) {
    throw new Error(`Created rule ${rule.id} was not returned by rule list`);
  }
  console.log('List owned rules: OK');

  const session = await fetchJson('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      businessId: business.id,
      benefitRuleId: rule.id,
    }),
  });
  if (session.benefitRuleId !== rule.id) {
    throw new Error(`Session ${session.sessionId} was not bound to rule ${rule.id}`);
  }
  console.log(`Created QR session: ${session.sessionId}`);

  const challenge = await fetchJson(`/api/sessions/${session.sessionId}/challenge`);
  const customerSignature = await customerWallet.signMessage(challenge.message);
  const attest = await fetchJson('/api/attest', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: session.sessionId,
      signature: customerSignature,
    }),
  });
  console.log(`Customer attest result: ${attest.status}`);

  if (attest.status === 'APPROVED') {
    const redeemAuth = await signSellerAction(wallet, 'sessions:redeem', session.sessionId);
    const redeemed = await fetchJson(`/api/sessions/${session.sessionId}/redeem`, {
      method: 'POST',
      headers: sellerHeaders(redeemAuth),
    });
    if (redeemed.status !== 'REDEEMED') {
      throw new Error(`Expected redeemed session, got ${JSON.stringify(redeemed)}`);
    }
    console.log('Redeemed approved session: OK');
  } else if (attest.status === 'REJECTED') {
    if (customerPrivateKey) {
      throw new Error(`Customer wallet was expected to be eligible, got rejected: ${attest.reason || 'no reason'}`);
    }
    const redeemAuth = await signSellerAction(wallet, 'sessions:redeem', session.sessionId);
    await expectHttpStatus(`/api/sessions/${session.sessionId}/redeem`, 409, {
      method: 'POST',
      headers: sellerHeaders(redeemAuth),
    });
    console.log(`Rejected throwaway customer as expected: ${attest.reason || 'not eligible'}`);
    console.log('Redeem rejected session blocked: OK');
  } else {
    throw new Error(`Unexpected attest status ${attest.status}`);
  }

  if (cleanup) {
    const deleteRuleAuth = await signSellerAction(wallet, 'rules:delete', business.id);
    await fetchNoContent(`/api/seller/rules/${rule.id}`, {
      method: 'DELETE',
      headers: sellerHeaders(deleteRuleAuth),
    });
    console.log('Deleted smoke rule: OK');
  } else {
    console.log('Cleanup disabled; smoke rule left active.');
  }

  if (cleanup) {
    const deleteBusinessAuth = await signSellerAction(wallet, 'business:delete', business.id);
    await fetchNoContent(`/api/seller/businesses/${business.id}`, {
      method: 'DELETE',
      headers: sellerHeaders(deleteBusinessAuth),
    });

    const postCleanupAuth = await signSellerAction(wallet, 'business:list', 'seller');
    const postCleanup = await fetchJson('/api/seller/businesses', {
      headers: sellerHeaders(postCleanupAuth),
    });
    if (postCleanup.businesses.some((entry) => entry.id === business.id)) {
      throw new Error(`Deactivated business ${business.id} is still returned by owner reload`);
    }
    const deactivatedRuleAuth = await signSellerAction(wallet, 'rules:create', business.id);
    await expectHttpStatus(`/api/seller/businesses/${business.id}/rules`, 404, {
      method: 'POST',
      headers: sellerHeaders(deactivatedRuleAuth),
      body: JSON.stringify({
        label: 'Should not save',
        category: 'Test',
        productName: 'Deactivated seller rule',
        discountPercent: 1,
        requiredLockIFR: 1,
        ttlSeconds: 60,
        active: true,
      }),
    });
    console.log('Deactivated smoke seller profile: OK');
    console.log('Deactivated seller rule writes blocked: OK');
  } else {
    console.log('Cleanup disabled; smoke seller profile left active.');
  }

  console.log('Seller wallet smoke complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
