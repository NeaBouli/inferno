// commands/price.js — /price
const axios = require('axios');
const cache = require('../services/cache');
const logger = require('../services/logger');

async function priceCommand(ctx) {
  const loadingMsg = await ctx.reply('💰 Fetching price data...');

  try {
    const cacheKey = 'price_data';
    let data = cache.get(cacheKey);

    if (!data) {
      const url = `${process.env.RAILWAY_API_URL}/api/ifr/supply`;
      const res = await axios.get(url, { timeout: 5000 });
      data = res.data;
      cache.set(cacheKey, data, 60);
    }

    // Check if LP / price data is available
    const price = data.price ?? data.priceUsd ?? null;

    let reply;
    if (!price || price === 0) {
      reply =
        '💰 *IFR Price*\n\n' +
        '🔄 No liquidity pool yet — launching soon.\n\n' +
        `📊 Supply: ${Number(data.totalSupply ?? 0).toLocaleString('en-US')} IFR\n` +
        `🔥 Burned: ${Number(data.burned ?? data.totalBurned ?? 0).toLocaleString('en-US')} IFR\n\n` +
        '🌐 [ifrunit.tech](https://ifrunit.tech)';
    } else {
      const priceFmt = parseFloat(price).toFixed(6);
      reply =
        '💰 *IFR Price*\n\n' +
        `💲 Price: $${priceFmt}\n` +
        `📊 Supply: ${Number(data.totalSupply ?? 0).toLocaleString('en-US')} IFR\n` +
        `🔥 Burned: ${Number(data.burned ?? data.totalBurned ?? 0).toLocaleString('en-US')} IFR\n\n` +
        '🌐 [ifrunit.tech](https://ifrunit.tech)';
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      reply,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  } catch (err) {
    logger.error({ err: err.message }, '/price error');
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '❌ Could not fetch price data. Try again later.'
    );
  }
}

module.exports = priceCommand;
