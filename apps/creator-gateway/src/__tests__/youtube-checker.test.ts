import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { YouTubeChecker } from '../services/youtube-checker';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

// Mock googleapis
vi.mock('googleapis', () => {
  return {
    google: {
      youtube: () => ({
        members: { list: mockList },
      }),
      auth: {
        OAuth2: vi.fn().mockImplementation(function () { return {
          setCredentials: vi.fn(),
        }; }),
      },
    },
    __mockList: mockList,
  };
});


describe('YouTubeChecker', () => {
  let checker: YouTubeChecker;

  beforeEach(() => {
    checker = new YouTubeChecker();
    vi.clearAllMocks();
  });

  it('returns true when user is a channel member', async () => {
    mockList.mockResolvedValueOnce({
      data: { items: [{ snippet: { channelId: 'test' } }] },
    });

    const result = await checker.isMember('valid-token');
    expect(result).toBe(true);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        part: ['snippet'],
        mode: 'listMembers',
        maxResults: 1,
      })
    );
  });

  it('returns false when user is not a channel member', async () => {
    mockList.mockResolvedValueOnce({
      data: { items: [] },
    });

    const result = await checker.isMember('valid-token-no-membership');
    expect(result).toBe(false);
  });

  it('returns false when items is undefined', async () => {
    mockList.mockResolvedValueOnce({
      data: {},
    });

    const result = await checker.isMember('valid-token-no-items');
    expect(result).toBe(false);
  });

  it('returns false on API error (fail-closed)', async () => {
    mockList.mockRejectedValueOnce(new Error('API quota exceeded'));

    const result = await checker.isMember('bad-token');
    expect(result).toBe(false);
  });

  it('returns false on network error (fail-closed)', async () => {
    mockList.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await checker.isMember('network-fail-token');
    expect(result).toBe(false);
  });

  it('returns false on invalid token (fail-closed)', async () => {
    mockList.mockRejectedValueOnce(new Error('Invalid Credentials'));

    const result = await checker.isMember('expired-token');
    expect(result).toBe(false);
  });
});
