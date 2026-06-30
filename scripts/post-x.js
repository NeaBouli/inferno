#!/usr/bin/env node
'use strict';

/**
 * Post a single X post or a thread via the official X API.
 *
 * Defaults to dry-run. Live posting requires:
 *   Credentials in local x.env plus X_DRY_RUN=false X_ALLOW_LIVE=true
 *
 * Input files can contain one post, or multiple posts separated by a line:
 *   ---tweet---
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

const CREATE_POST_URL = 'https://api.x.com/2/tweets';
const REFRESH_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const THREAD_SEPARATOR = /^---tweet---$/gim;
const MAX_POST_CHARS = 280;

function loadEnvFiles() {
  const envFiles = [
    process.env.X_ENV_FILE,
    'x.env',
    '.env',
  ].filter(Boolean);

  envFiles.forEach(file => {
    const absPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(absPath)) {
      dotenv.config({ path: absPath, quiet: true });
    }
  });
}

loadEnvFiles();

function envFlag(name, defaultValue) {
  if (process.env[name] == null) return defaultValue;
  return String(process.env[name]).toLowerCase() === 'true';
}

function usage() {
  console.log([
    'Usage:',
    '  X_DRY_RUN=true node scripts/post-x.js docs/social/x-post.md',
    '  X_DRY_RUN=false X_ALLOW_LIVE=true node scripts/post-x.js docs/social/x-post.md',
    '',
    'Optional env:',
    '  X_ENV_FILE=...         Load credentials from a custom local env file',
    '  X_REPLY_TO_ID=...       Start the thread as a reply to an existing post',
    '  X_CONSUMER_KEY=...      OAuth 1.0a consumer key / API key',
    '  X_CONSUMER_SECRET=...   OAuth 1.0a consumer secret / API secret',
    '  X_ACCESS_TOKEN=...      OAuth 1.0a access token or OAuth2 bearer access token',
    '  X_ACCESS_TOKEN_SECRET=... OAuth 1.0a access token secret',
    '  X_REFRESH_TOKEN=...     Refresh OAuth2 access token before posting',
    '  X_CLIENT_ID=...         OAuth2 client id for refresh',
    '  X_CLIENT_SECRET=...     OAuth2 client secret for confidential apps',
  ].join('\n'));
}

function readPostFile(filePath) {
  if (!filePath) {
    usage();
    throw new Error('Missing input file');
  }
  const absPath = path.resolve(process.cwd(), filePath);
  const text = fs.readFileSync(absPath, 'utf8').trim();
  if (!text) throw new Error(`Input file is empty: ${filePath}`);
  return { absPath, text };
}

function splitPosts(text) {
  return text
    .split(THREAD_SEPARATOR)
    .map(part => part.trim())
    .filter(Boolean);
}

function charCount(text) {
  return Array.from(text).length;
}

function validatePosts(posts) {
  if (!posts.length) throw new Error('No posts found');
  posts.forEach((post, index) => {
    const count = charCount(post);
    if (count > MAX_POST_CHARS) {
      throw new Error(`Post ${index + 1} has ${count} chars. X limit is ${MAX_POST_CHARS}. Split with ---tweet---.`);
    }
  });
}

function oauthEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createOAuth1AuthHeader(method, url) {
  const consumerKey = process.env.X_CONSUMER_KEY || process.env.X_API_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET || process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  const missing = [];
  if (!consumerKey) missing.push('X_CONSUMER_KEY');
  if (!consumerSecret) missing.push('X_CONSUMER_SECRET');
  if (!accessToken) missing.push('X_ACCESS_TOKEN');
  if (!accessTokenSecret) missing.push('X_ACCESS_TOKEN_SECRET');
  if (missing.length) throw new Error(`Missing OAuth 1.0a credentials: ${missing.join(', ')}`);

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const parameterString = Object.entries(oauthParams)
    .map(([key, value]) => [oauthEncode(key), oauthEncode(value)])
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    oauthEncode(url),
    oauthEncode(parameterString),
  ].join('&');
  const signingKey = `${oauthEncode(consumerSecret)}&${oauthEncode(accessTokenSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  return 'OAuth ' + Object.entries(oauthParams)
    .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
    .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
    .join(', ');
}

function bearerAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function refreshAccessTokenIfConfigured() {
  const refreshToken = process.env.X_REFRESH_TOKEN;
  const clientId = process.env.X_CLIENT_ID;
  if (!refreshToken) return process.env.X_ACCESS_TOKEN || '';
  if (!clientId) throw new Error('X_CLIENT_ID is required when X_REFRESH_TOKEN is set');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('client_id', clientId);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (process.env.X_CLIENT_SECRET) {
    const basic = Buffer.from(`${clientId}:${process.env.X_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const res = await fetch(REFRESH_TOKEN_URL, {
    method: 'POST',
    headers,
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X token refresh failed (${res.status}): ${JSON.stringify(json)}`);
  }
  console.log('X OAuth access token refreshed for this run.');
  if (json.refresh_token) {
    console.log('X returned a new refresh token. Store it securely; it is not printed by this script.');
  }
  return json.access_token;
}

function getAuthMode() {
  if (process.env.X_ACCESS_TOKEN_SECRET || process.env.X_CONSUMER_KEY || process.env.X_API_KEY) {
    return 'oauth1';
  }
  return 'bearer';
}

async function getBearerAccessToken() {
  const accessToken = await refreshAccessTokenIfConfigured();
  if (!accessToken) {
    throw new Error(
      'X_ACCESS_TOKEN is required for OAuth2 bearer posting, unless refresh credentials are configured. ' +
      'For OAuth 1.0a posting, set X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, and X_ACCESS_TOKEN_SECRET.'
    );
  }
  return accessToken;
}

async function createPost(auth, text, replyToId) {
  const payload = { text };
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: String(replyToId) };
  }

  const headers = auth.mode === 'oauth1'
    ? { Authorization: createOAuth1AuthHeader('POST', CREATE_POST_URL), 'Content-Type': 'application/json' }
    : bearerAuthHeaders(auth.accessToken);

  const res = await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X create post failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const input = process.argv[2];
  const { absPath, text } = readPostFile(input);
  const posts = splitPosts(text);
  validatePosts(posts);

  const dryRun = envFlag('X_DRY_RUN', envFlag('DRY_RUN', true));
  const allowLive = envFlag('X_ALLOW_LIVE', false);
  const initialReplyToId = process.env.X_REPLY_TO_ID || '';

  console.log('=== X POST PLAN ===');
  console.log('Input:', absPath);
  console.log('Mode:', dryRun ? 'DRY_RUN' : 'LIVE');
  console.log('Posts:', posts.length);
  if (initialReplyToId) console.log('Initial reply target:', initialReplyToId);
  posts.forEach((post, index) => {
    console.log(`\n--- Post ${index + 1}/${posts.length} (${charCount(post)} chars) ---`);
    console.log(post);
  });

  if (dryRun) {
    console.log('\nDry-run only. Set X_DRY_RUN=false and X_ALLOW_LIVE=true to publish.');
    return;
  }
  if (!allowLive) {
    throw new Error('Live posting blocked. Set X_ALLOW_LIVE=true explicitly.');
  }

  const authMode = getAuthMode();
  const auth = authMode === 'oauth1'
    ? { mode: 'oauth1' }
    : { mode: 'bearer', accessToken: await getBearerAccessToken() };
  console.log('Auth:', auth.mode === 'oauth1' ? 'OAuth 1.0a user context' : 'OAuth2 bearer/user context');

  const results = [];
  let replyToId = initialReplyToId;
  for (let i = 0; i < posts.length; i++) {
    const result = await createPost(auth, posts[i], replyToId);
    const id = result && result.data && result.data.id;
    if (!id) throw new Error(`X response did not include post id: ${JSON.stringify(result)}`);
    results.push({ index: i + 1, id, text: result.data.text });
    replyToId = id;
    console.log(`Published post ${i + 1}/${posts.length}: ${id}`);
  }

  console.log('\n=== X POST RESULT ===');
  results.forEach(result => {
    console.log(`Post ${result.index}: https://x.com/IFRtoken/status/${result.id}`);
  });
}

main().catch(err => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
