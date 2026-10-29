import { google } from 'googleapis';
import { CONFIG } from '../config';

export class YouTubeChecker {
  async isMember(visitorChannelId: string, creatorChannelId: string): Promise<boolean> {
    if (!CONFIG.youtubeCreatorRefreshToken ||
        !CONFIG.google.clientId.trim() || !CONFIG.google.clientSecret.trim() ||
        typeof visitorChannelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(visitorChannelId) ||
        typeof creatorChannelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(creatorChannelId) ||
        creatorChannelId !== CONFIG.youtubeChannelId) return false;

    try {
      const youtube = google.youtube('v3');
      const auth = new google.auth.OAuth2({
        clientId: CONFIG.google.clientId,
        clientSecret: CONFIG.google.clientSecret,
        transporterOptions: { timeout: 5_000 },
      });
      auth.setCredentials({ refresh_token: CONFIG.youtubeCreatorRefreshToken });

      const response = await youtube.members.list(
        {
          auth,
          part: ['snippet'],
          mode: 'all_current',
          filterByMemberChannelId: visitorChannelId,
          maxResults: 1,
        },
        { timeout: 5_000, retry: false }
      );

      const items = response.data.items;
      return Array.isArray(items) && items.length === 1 &&
        items[0]?.snippet?.creatorChannelId === creatorChannelId &&
        items[0]?.snippet?.memberDetails?.channelId === visitorChannelId;
    } catch {
      return false; // fail-closed
    }
  }
}

export const youtubeChecker = new YouTubeChecker();
