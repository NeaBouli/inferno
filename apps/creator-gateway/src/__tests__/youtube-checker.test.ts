import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';

const { memberList, clients } = vi.hoisted(() => ({
  memberList: vi.fn(),
  clients: [] as Array<{ options: unknown; setCredentials: Mock }>,
}));
vi.mock('googleapis', () => ({
  google: {
    youtube: () => ({ members: { list: memberList } }),
    auth: {
      OAuth2: vi.fn(function (options: unknown) {
        const client = { options, setCredentials: vi.fn() };
        clients.push(client);
        return client;
      }),
    },
  },
}));

const CREATOR = `UC${'C'.repeat(22)}`;
const VISITOR = `UC${'V'.repeat(22)}`;
const OTHER = `UC${'X'.repeat(22)}`;
const savedEnv = process.env;
beforeEach(() => {
  process.env = {
    NODE_ENV: 'test', JWT_SECRET: 'synthetic-youtube-checker-jwt-at-least-32-bytes',
    SIWE_DOMAIN: 'localhost', SIWE_URI: 'http://localhost:3005',
    GOOGLE_CLIENT_ID: 'synthetic-app-client', GOOGLE_CLIENT_SECRET: 'synthetic-app-secret',
    YOUTUBE_CHANNEL_ID: CREATOR, YOUTUBE_CREATOR_REFRESH_TOKEN: 'synthetic-creator-refresh',
  };
  vi.resetModules();
  memberList.mockReset();
  clients.length = 0;
});
afterEach(() => { process.env = savedEnv; vi.restoreAllMocks(); });

async function checker() {
  return (await import('../services/youtube-checker')).youtubeChecker;
}
const exact = { snippet: { creatorChannelId: CREATOR, memberDetails: { channelId: VISITOR } } };

test('only the configured creator client queries the supported filtered membership API', async () => {
  memberList.mockResolvedValue({ data: { items: [exact] } });
  expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(true);
  expect(clients).toHaveLength(1);
  expect(clients[0].options).toEqual({
    clientId: 'synthetic-app-client', clientSecret: 'synthetic-app-secret',
    transporterOptions: { timeout: 5_000 },
  });
  expect(clients[0].setCredentials).toHaveBeenCalledExactlyOnceWith({
    refresh_token: 'synthetic-creator-refresh',
  });
  expect(memberList).toHaveBeenCalledExactlyOnceWith({
    auth: clients[0], part: ['snippet'], mode: 'all_current',
    filterByMemberChannelId: VISITOR, maxResults: 1,
  }, { timeout: 5_000, retry: false });
});

test.each([
  { pageInfo: { totalResults: 1 } },
  { nextPageToken: '', pageInfo: { totalResults: 1 } },
])('consistent single-result metadata preserves exact membership proof (%j)', async (metadata) => {
  memberList.mockResolvedValue({ data: { ...metadata, items: [exact] } });
  expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(true);
  expect(memberList).toHaveBeenCalledTimes(1);
});

test.each([
  { nextPageToken: 'another-page' }, { nextPageToken: 0 },
  { pageInfo: { totalResults: 2 } }, { pageInfo: { totalResults: 0 } },
  { pageInfo: { totalResults: '1' } }, { pageInfo: { totalResults: null } },
  { pageInfo: { totalResults: 1.5 } },
])('pagination or contradictory/malformed totals deny even an exact member (%j)', async (metadata) => {
  memberList.mockResolvedValue({ data: { ...metadata, items: [exact] } });
  expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(false);
  expect(memberList).toHaveBeenCalledTimes(1);
});

test.each([
  { name: 'YOUTUBE_CREATOR_REFRESH_TOKEN', value: undefined },
  { name: 'YOUTUBE_CREATOR_REFRESH_TOKEN', value: '' },
  { name: 'YOUTUBE_CREATOR_REFRESH_TOKEN', value: '   ' },
  { name: 'GOOGLE_CLIENT_ID', value: '' },
  { name: 'GOOGLE_CLIENT_SECRET', value: '' },
  { name: 'YOUTUBE_CHANNEL_ID', value: '' },
])('missing creator configuration denies before provider access ($name=$value)', async ({ name, value }) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(false);
  expect(clients).toHaveLength(0);
  expect(memberList).not.toHaveBeenCalled();
});

test.each([
  [VISITOR, OTHER], [VISITOR, ''], ['', CREATOR], ['not-a-channel', CREATOR],
  [` ${VISITOR}`, CREATOR], [VISITOR, 'not-a-channel'],
])('invalid visitor/policy channel denies before provider access (%s,%s)', async (visitor, creator) => {
  expect(await (await checker()).isMember(visitor, creator)).toBe(false);
  expect(clients).toHaveLength(0);
  expect(memberList).not.toHaveBeenCalled();
});

test.each([
  undefined, null, {}, { items: null }, { items: {} }, { items: [] },
  { items: [null] }, { items: [{}] }, { items: [{ snippet: {} }] },
  { items: [{ snippet: { channelId: VISITOR } }] },
  { items: [{ snippet: { creatorChannelId: CREATOR } }] },
  { items: [{ snippet: { creatorChannelId: CREATOR, memberDetails: {} } }] },
  { items: [{ snippet: { creatorChannelId: OTHER, memberDetails: { channelId: VISITOR } } }] },
  { items: [{ snippet: { creatorChannelId: CREATOR, memberDetails: { channelId: OTHER } } }] },
  { items: [exact, exact] },
])('malformed, unavailable or unrelated member proof fails closed (%j)', async (data) => {
  memberList.mockResolvedValue({ data });
  expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(false);
  expect(memberList).toHaveBeenCalledTimes(1);
});

test.each(['quotaExceeded', 'channelMembershipsNotEnabled', 'invalid_grant', 'revoked', 'ETIMEDOUT', 'ECONNREFUSED'])(
  'provider failure denies without disclosing raw request/credential data (%s)', async (message) => {
    const error = Object.assign(new Error(message), {
      config: { headers: { authorization: 'Bearer SYNTHETIC-SECRET-SENTINEL' } },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    memberList.mockRejectedValue(error);
    expect(await (await checker()).isMember(VISITOR, CREATOR)).toBe(false);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  }
);
