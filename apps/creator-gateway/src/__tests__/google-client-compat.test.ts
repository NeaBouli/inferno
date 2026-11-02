import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { google } from 'googleapis';

const appRequire = createRequire(resolve(process.cwd(), 'package.json'));
const googleRequire = createRequire(appRequire.resolve('googleapis'));
const selectedAuthPath = googleRequire.resolve('google-auth-library');
const selectedAuth = googleRequire('google-auth-library') as { OAuth2Client: unknown };
const selectedAuthRelative = relative(process.cwd(), selectedAuthPath);
const selectedAuthSha256 = createHash('sha256').update(readFileSync(selectedAuthPath)).digest('hex');

// Deliberately use the installed modules, not the application tests' googleapis mock.
const viewerId = `UC${'v'.repeat(22)}`;
const creatorId = `UC${'c'.repeat(22)}`;
const paths = new Set(['/token', '/youtube/v3/channels', '/youtube/v3/members', '/error', '/timeout']);
const calls: { path: string; method: string; authorization?: string; query: URLSearchParams; form: URLSearchParams }[] = [];
let origin: string;
let fixtureFailures = 0;

const closedFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.origin !== origin || !paths.has(url.pathname) ||
      (url.pathname === '/token' ? method !== 'POST' : method !== 'GET')) {
    return Promise.reject(new Error('OFFLINE_TARGET_DENIED'));
  }
  return fetch(input, { ...init, redirect: 'error' });
};

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', origin);
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 4096) throw new Error('FIXTURE_BODY_LIMIT');
  }
  const form = new URLSearchParams(body);
  calls.push({ path: url.pathname, method: request.method ?? '', authorization: request.headers.authorization,
    query: url.searchParams, form });
  if (!paths.has(url.pathname)) throw new Error('FIXTURE_PATH_DENIED');
  if (url.pathname === '/timeout') return;
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/token') {
    const owner = form.get('grant_type') === 'refresh_token' ? 'creator' : 'viewer';
    response.end(JSON.stringify({ access_token: `fixture-${owner}-access`, expires_in: 3600, token_type: 'Bearer' }));
  } else if (url.pathname === '/youtube/v3/channels') {
    response.end(JSON.stringify({ items: [{ id: viewerId }], pageInfo: { totalResults: 1 } }));
  } else if (url.pathname === '/youtube/v3/members') {
    response.end(JSON.stringify({ items: [{ snippet: { creatorChannelId: creatorId,
      memberDetails: { channelId: viewerId } } }], pageInfo: { totalResults: 1 } }));
  } else {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: { message: 'synthetic-provider-error' } }));
  }
}

const server = createServer((request, response) => {
  void serve(request, response).catch(() => {
    fixtureFailures += 1;
    response.statusCode = 500;
    response.end('{}');
  });
});

function client() {
  return new google.auth.OAuth2({ clientId: 'fixture-client', clientSecret: 'fixture-client-secret',
    redirectUri: `${origin}/callback`, endpoints: { oauth2TokenUrl: `${origin}/token` },
    transporterOptions: { timeout: 5_000, retry: false, fetchImplementation: closedFetch } });
}

function failureFields(error: unknown): { code: unknown; status: unknown } {
  if (error === null || typeof error !== 'object') return { code: undefined, status: undefined };
  const native = error as { code?: unknown; response?: { status?: unknown } };
  return { code: native.code, status: native.response?.status };
}

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => { calls.length = 0; fixtureFailures = 0; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('installed Google client compatibility with closed offline HTTP', () => {
  it('binds the privacy constructor to the actual Googleapis-selected module and lock entry', () => {
    const metadata = JSON.parse(readFileSync(googleRequire.resolve('google-auth-library/package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(google.auth.OAuth2 === selectedAuth.OAuth2Client).toBe(true);
    expect(selectedAuthRelative).toBe('node_modules/google-auth-library/build/src/index.js');
    expect(metadata.version).toBe('11.3.2');
    expect(lock.packages['node_modules/google-auth-library'].version).toBe(metadata.version);
  });

  it('keeps separate viewer token exchange and creator refresh through real OAuth/YouTube clients', async () => {
    const viewer = client();
    const { tokens } = await viewer.getToken('fixture-viewer-code');
    viewer.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', rootUrl: origin });
    const channels = await youtube.channels.list({ auth: viewer, part: ['id'], mine: true },
      { timeout: 5_000, retry: false, fetchImplementation: closedFetch });
    const creator = client();
    creator.setCredentials({ refresh_token: 'fixture-creator-refresh' });
    const members = await youtube.members.list({ auth: creator, part: ['snippet'], mode: 'all_current',
      filterByMemberChannelId: viewerId, maxResults: 1 },
      { timeout: 5_000, retry: false, fetchImplementation: closedFetch });

    expect(channels.data.items?.map(item => item.id)).toEqual([viewerId]);
    expect(members.data.items?.[0]?.snippet?.creatorChannelId).toBe(creatorId);
    expect(members.data.items?.[0]?.snippet?.memberDetails?.channelId).toBe(viewerId);
    expect(members.data.pageInfo?.totalResults).toBe(1);
    expect(viewer.transporter.defaults.timeout).toBe(5_000);
    expect(channels.config.timeout).toBe(5_000);
    expect(channels.config.retry).toBe(false);
    expect(members.config.timeout).toBe(5_000);
    expect(members.config.retry).toBe(false);
    expect(calls.map(call => [call.method, call.path])).toEqual([
      ['POST', '/token'], ['GET', '/youtube/v3/channels'], ['POST', '/token'], ['GET', '/youtube/v3/members'],
    ]);
    expect(calls[0].form.get('code')).toBe('fixture-viewer-code');
    expect(calls[0].form.get('client_secret')).toBe('fixture-client-secret');
    expect(calls[2].form.get('grant_type')).toBe('refresh_token');
    expect(calls[2].form.get('refresh_token')).toBe('fixture-creator-refresh');
    expect(calls[1].authorization).toBe('Bearer fixture-viewer-access');
    expect(calls[3].authorization).toBe('Bearer fixture-creator-access');
    expect(calls[1].query.get('mine')).toBe('true');
    expect(calls[3].query.get('filterByMemberChannelId')).toBe(viewerId);
    expect(calls[3].query.get('maxResults')).toBe('1');
    expect(fixtureFailures).toBe(0);
  });

  it('preserves native error response shape and retry:false on a retriable status', async () => {
    let failure: unknown;
    try { await client().transporter.request({ url: `${origin}/error`, retry: false }); }
    catch (error) { failure = error; }
    expect(failureFields(failure).status).toBe(503);
    expect(calls.filter(call => call.path === '/error')).toHaveLength(1);
    expect(fixtureFailures).toBe(0);
  });

  it('bounds actual HTTP with its timeout signal and does not retry', async () => {
    const started = performance.now();
    let failure: unknown;
    try { await client().transporter.request({ url: `${origin}/timeout`, timeout: 50, retry: false }); }
    catch (error) { failure = error; }
    expect(failureFields(failure).code).toBe('TimeoutError');
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(calls.filter(call => call.path === '/timeout')).toHaveLength(1);
    expect(fixtureFailures).toBe(0);
  });

  it('refuses a nonfixture destination before any fetch', async () => {
    await expect(closedFetch('https://not-a-provider.invalid/')).rejects.toThrow('OFFLINE_TARGET_DENIED');
    expect(calls).toHaveLength(0);
  });
});

// Fresh processes exercise the actual logger's import-time defaults. Their raw
// synthetic payload logs stay in bounded RAM and are never forwarded to test output.
const privacyProgram = String.raw`
'use strict';
const {createServer} = require('node:http');
const parentRequire = require('node:module').createRequire(require.resolve('googleapis'));
const {OAuth2Client} = parentRequire('google-auth-library');
const authPath = parentRequire.resolve('google-auth-library');
const authVersion = parentRequire('google-auth-library/package.json').version;
const authRelative = require('node:path').relative(process.cwd(), authPath);
const authSha256 = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(authPath)).digest('hex');
const marker = 'SYNTHETIC_GOOGLE_PRIVACY_SENTINEL';
let origin; let requests = 0;
const server = createServer((req, res) => {
  requests += 1; req.resume(); res.setHeader('Content-Type', 'application/json');
  if (req.url === '/token') res.end(JSON.stringify({access_token: marker, expires_in:3600, token_type:'Bearer'}));
  else if (req.url === '/ok') res.end(JSON.stringify({privateFixture:marker}));
  else if (req.url === '/error') {res.statusCode=400;res.end(JSON.stringify({error:marker}));}
  else {res.statusCode=500;res.end('{}');}
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin='http://127.0.0.1:'+server.address().port;
    const closedFetch=(input,init)=>{
      const u=new URL(input instanceof Request?input.url:String(input));
      if(u.origin!==origin || !['/token','/ok','/error'].includes(u.pathname)) throw new Error('OFFLINE_TARGET_DENIED');
      return fetch(input,{...init,redirect:'error'});
    };
    const auth=new OAuth2Client({clientId:'fixture-client',clientSecret:marker,
      endpoints:{oauth2TokenUrl:origin+'/token'},transporterOptions:{timeout:1000,retry:false,fetchImplementation:closedFetch}});
    const {tokens}=await auth.getToken('fixture-code'); auth.setCredentials(tokens);
    await auth.request({url:origin+'/ok',retry:false});
    let rejected=false;
    try {await auth.request({url:origin+'/error',retry:false});} catch(e) {rejected=e.response?.status===400;}
    if(!rejected || requests!==3) throw new Error('FIXTURE_CONTRACT');
    process.stdout.write(JSON.stringify({status:'PASS',requests,authVersion,authRelative,authSha256})+'\n');
  } catch {process.exitCode=1; process.stdout.write('FIXED_PRIVACY_CONTROL_FAIL\n');}
  finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
})();
`;

it.each(['unset', 'unrelated', 'auth'] as const)('qualifies actual default logging boundary: %s', mode => {
  const env: NodeJS.ProcessEnv = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_OPTIONS: '--max-old-space-size=512',
    NO_COLOR: '1', CI: 'true', TMPDIR: process.env.TMPDIR,
  };
  if (mode !== 'unset') env.GOOGLE_SDK_NODE_LOGGING = mode;
  const started = performance.now();
  const result = spawnSync(process.execPath, ['-e', privacyProgram], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 3_500, maxBuffer: 16_384, killSignal: 'SIGKILL',
  });
  const spawnFailure = result.error === undefined ? null : (failureFields(result.error).code ?? 'UNCLASSIFIED');
  const expected = { status: 'PASS', requests: 3, authVersion: '11.3.2',
    authRelative: selectedAuthRelative, authSha256: selectedAuthSha256 };
  let metadata: unknown;
  try { metadata = JSON.parse(result.stdout); } catch { metadata = null; }
  const moduleBound = JSON.stringify(metadata) === JSON.stringify(expected);
  const disclosed = result.stderr.includes('SYNTHETIC_GOOGLE_PRIVACY_SENTINEL');
  process.stdout.write('CREATOR_GOOGLE_PRIVACY ' + JSON.stringify({ mode, elapsedMs: Math.round(performance.now() - started),
    spawnFailure, exitCode: result.status, signal: result.signal, moduleBound, payloadDisclosed: disclosed }) + '\n');
  expect(spawnFailure).toBeNull();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(metadata).toEqual(expected);
  expect(disclosed).toBe(mode === 'auth'); // Positive control makes the default nondisclosure assertion meaningful.
  expect(Buffer.byteLength(result.stderr)).toBeLessThan(16_384);
});
