// services/cache.js — In-Memory Cache mit TTL
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS || '60'),
  checkperiod: 30,
  useClones: false,
});

module.exports = cache;
