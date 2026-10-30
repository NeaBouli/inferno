import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { checkEntitlement, DEFAULT_ENTITLEMENT, EntitlementConfig } from '../services/entitlement';
import { CONFIG } from '../config';
import { lockChecker } from '../services/lock-checker';
import { youtubeChecker } from '../services/youtube-checker';

vi.mock('../services/lock-checker', () => ({
  lockChecker: { isLocked: vi.fn() },
}));
vi.mock('../services/youtube-checker', () => ({
  youtubeChecker: { isMember: vi.fn() },
}));

const mockLock = lockChecker.isLocked as Mock;
const mockYT = youtubeChecker.isMember as Mock;
const CREATOR = 'UCCCCCCCCCCCCCCCCCCCCCCC';
const VISITOR = 'UCVVVVVVVVVVVVVVVVVVVVVV';

describe('checkEntitlement — OR logic', () => {
  const config: EntitlementConfig = {
    logic: 'OR',
    conditions: [
      { type: 'youtube_member', channelId: CREATOR },
      { type: 'ifr_lock', minIFR: '1000' },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  test('granted if YouTube member only', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement(undefined, VISITOR, config);
    expect(r.granted).toBe(true);
    expect(r.reasons).toContain('YouTube Member');
    expect(mockYT).toHaveBeenCalledWith(VISITOR, CREATOR);
  });

  test('granted if IFR locked only', async () => {
    mockYT.mockResolvedValue(false);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', undefined, config);
    expect(r.granted).toBe(true);
    expect(r.reasons).toContain('IFR Lock >= 1000 IFR');
  });

  test('granted if both satisfied', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', VISITOR, config);
    expect(r.granted).toBe(true);
    expect(r.reasons).toHaveLength(2);
  });

  test('denied if neither satisfied', async () => {
    mockYT.mockResolvedValue(false);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement('0xWALLET', VISITOR, config);
    expect(r.granted).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });
});

describe('checkEntitlement — AND logic', () => {
  const config: EntitlementConfig = {
    logic: 'AND',
    conditions: [
      { type: 'youtube_member', channelId: CREATOR },
      { type: 'ifr_lock', minIFR: '5000' },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  test('granted only if both satisfied', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', VISITOR, config);
    expect(r.granted).toBe(true);
  });

  test('denied if only YouTube member', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement('0xWALLET', VISITOR, config);
    expect(r.granted).toBe(false);
  });

  test('denied if only IFR locked', async () => {
    mockYT.mockResolvedValue(false);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', VISITOR, config);
    expect(r.granted).toBe(false);
  });
});

test('default YouTube condition is bound to the configured creator channel', () => {
  expect(DEFAULT_ENTITLEMENT.conditions).toContainEqual({
    type: 'youtube_member', channelId: CONFIG.youtubeChannelId,
  });
});

test('a channel-less legacy YouTube condition cannot grant even if the checker would', async () => {
  vi.clearAllMocks();
  mockYT.mockResolvedValue(true);
  const legacy = { logic: 'AND', conditions: [{ type: 'youtube_member' }] } as EntitlementConfig;
  expect(await checkEntitlement(undefined, VISITOR, legacy)).toEqual({ granted: false, reasons: [] });
  expect(mockYT).not.toHaveBeenCalled();
});
