export const CONFIG = {
  port: parseInt(process.env.PORT || '3005'),
  rpcUrl: process.env.RPC_URL || '',
  ifrLockAddress: process.env.IFRLOCK_ADDRESS || '0x0Cab0A9440643128540222acC6eF5028736675d3',
  chainId: parseInt(process.env.CHAIN_ID || '11155111'),
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiryHours: 24,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3005/auth/google/callback',
  },
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || '',
  minLockIFR: process.env.MIN_LOCK_IFR || '1000',
  decimals: 9,
};
