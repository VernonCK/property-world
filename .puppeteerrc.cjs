const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Forces Chrome to download inside your project folder so Render doesn't wipe it
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};