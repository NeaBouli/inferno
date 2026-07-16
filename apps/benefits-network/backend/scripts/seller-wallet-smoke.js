#!/usr/bin/env node

const { ethers } = require('ethers');

const baseUrl = (process.env.BENEFITS_BASE_URL || 'https://shop.ifrunit.tech').replace(/\/$/, '');
const mutate = process.env.MUTATE === 'true';
const cleanup = process.env.CLEANUP !== 'false';

function usage() {
  console.log(`IFR Benefits Network seller wallet smoke

Usage:
  node scripts/seller-wallet-smoke.js
  MUTATE=true node scripts/seller-wallet-smoke.js
  BENEFITS_BASE_URL=http://localhost:3001 MUTATE=true node scripts/seller-wallet-smoke.js

Defaults:
  BENEFITS_BASE_URL=${baseUrl}
  MUTATE=false
  CLEANUP=true

What it checks:
  - public health endpoint
  - server-issued seller auth messages
  - signed seller profile list
  - with MUTATE=true: create wallet-owned seller profile, reload it, create/list/delete a rule

No private key is read from env or disk. The script creates a throwaway wallet in memory.`);
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

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const wallet = ethers.Wallet.createRandom();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const businessName = `IFR Smoke Seller ${stamp}`;

  console.log('IFR Benefits seller wallet smoke');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mode: ${mutate ? 'MUTATE' : 'READ_ONLY'}`);
  console.log(`Wallet: ${wallet.address}`);

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

  console.log('Seller wallet smoke complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
