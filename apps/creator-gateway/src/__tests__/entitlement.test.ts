import { checkEntitlement, EntitlementConfig } from '../services/entitlement';
import { lockChecker } from '../services/lock-checker';
import { youtubeChecker } from '../services/youtube-checker';

jest.mock('../services/lock-checker', () => ({
  lockChecker: { isLocked: jest.fn() },
}));
jest.mock('../services/youtube-checker', () => ({
  youtubeChecker: { isMember: jest.fn() },
}));

const mockLock = lockChecker.isLocked as jest.Mock;
const mockYT = youtubeChecker.isMember as jest.Mock;

describe('checkEntitlement — OR logic', () => {
  const config: EntitlementConfig = {
    logic: 'OR',
    conditions: [
      { type: 'youtube_member' },
      { type: 'ifr_lock', minIFR: '1000' },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  test('granted if YouTube member only', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement(undefined, 'yt-token', config);
    expect(r.granted).toBe(true);
    expect(r.reasons).toContain('YouTube Member');
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
    const r = await checkEntitlement('0xWALLET', 'yt-token', config);
    expect(r.granted).toBe(true);
    expect(r.reasons).toHaveLength(2);
  });

  test('denied if neither satisfied', async () => {
    mockYT.mockResolvedValue(false);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement('0xWALLET', 'yt-token', config);
    expect(r.granted).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });
});

describe('checkEntitlement — AND logic', () => {
  const config: EntitlementConfig = {
    logic: 'AND',
    conditions: [
      { type: 'youtube_member' },
      { type: 'ifr_lock', minIFR: '5000' },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  test('granted only if both satisfied', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', 'yt-token', config);
    expect(r.granted).toBe(true);
  });

  test('denied if only YouTube member', async () => {
    mockYT.mockResolvedValue(true);
    mockLock.mockResolvedValue(false);
    const r = await checkEntitlement('0xWALLET', 'yt-token', config);
    expect(r.granted).toBe(false);
  });

  test('denied if only IFR locked', async () => {
    mockYT.mockResolvedValue(false);
    mockLock.mockResolvedValue(true);
    const r = await checkEntitlement('0xWALLET', 'yt-token', config);
    expect(r.granted).toBe(false);
  });
});
