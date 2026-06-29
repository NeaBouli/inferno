#!/usr/bin/env node
'use strict';

/**
 * Post a single X post or a thread via the official X API.
 *
 * Defaults to dry-run. Live posting requires:
 *   X_DRY_RUN=false X_ALLOW_LIVE=true X_ACCESS_TOKEN=...
 *
 * Input files can contain one post, or multiple posts separated by a line:
 *   ---tweet---
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const CREATE_POST_URL = 'https://api.x.com/2/tweets';
const REFRESH_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const THREAD_SEPARATOR = /^---tweet---$/gim;
const MAX_POST_CHARS = 280;

function envFlag(name, defaultValue) {
  if (process.env[name] == null) return defaultValue;
  return String(process.env[name]).toLowerCase() === 'true';
}

function usage() {
  console.log([
    'Usage:',
    '  X_DRY_RUN=true node scripts/post-x.js docs/social/x-post.md',
    '  X_DRY_RUN=false X_ALLOW_LIVE=true X_ACCESS_TOKEN=... node scripts/post-x.js docs/social/x-post.md',
    '',
    'Optional env:',
    '  X_REPLY_TO_ID=...       Start the thread as a reply to an existing post',
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

function authHeaders(token) {
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

async function createPost(accessToken, text, replyToId) {
  const payload = { text };
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: String(replyToId) };
  }

  const res = await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
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

  const accessToken = await refreshAccessTokenIfConfigured();
  if (!accessToken) {
    throw new Error('X_ACCESS_TOKEN is required for live posting unless refresh credentials are configured.');
  }

  const results = [];
  let replyToId = initialReplyToId;
  for (let i = 0; i < posts.length; i++) {
    const result = await createPost(accessToken, posts[i], replyToId);
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
