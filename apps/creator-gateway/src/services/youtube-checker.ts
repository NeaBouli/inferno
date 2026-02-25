import { google } from 'googleapis';

export class YouTubeChecker {
  async isMember(accessToken: string): Promise<boolean> {
    try {
      const youtube = google.youtube('v3');
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const response = await youtube.members.list({
        auth,
        part: ['snippet'],
        mode: 'listMembers',
        maxResults: 1,
      });

      return (response.data.items?.length ?? 0) > 0;
    } catch {
      return false; // fail-closed
    }
  }
}

export const youtubeChecker = new YouTubeChecker();
