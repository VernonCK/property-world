'use strict';

const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');
const config = require('../config');

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (err) {
  console.warn('[instruction-pdf] puppeteer not installed — PDF rendering unavailable. Run: npm install puppeteer');
}

const TEMPLATES_DIR = path.resolve(config.paths.pdfTemplates, 'brokerage');

/* Shared browser instance — launched once, reused across requests */
let _browserPromise = null;
async function getBrowser() {
  if (!puppeteer) throw new Error('puppeteer module not available');
  if (!_browserPromise) {
    _browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
    });
  }
  return _browserPromise;
}

async function closeBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      await b.close();
    } catch (err) {
      console.warn('[instruction-pdf] browser close error:', err.message);
    } finally {
      _browserPromise = null;
    }
  }
}

/**
 * Render a brokerage instruction PDF.
 * Template contains Handlebars conditionals for residential/commercial
 * and sole/multiple variants — one file, four output shapes.
 *
 * @param {object} data — normalized template data (see BrokerageService)
 * @returns {Promise<Buffer>} A4 PDF buffer
 */
async function renderBrokerage({ data }) {
  const templatePath = path.join(TEMPLATES_DIR, 'instruction.html');
  const source = await fs.readFile(templatePath, 'utf8');
  const template = Handlebars.compile(source);
  const html = template(data);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
    return pdf;
  } finally {
    try { await page.close(); } catch {}
  }
}


/**
 * Render arbitrary HTML to a PDF buffer.
 * Used by services that compile their own Handlebars templates.
 */
async function renderHtml(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
  } finally {
    try { await page.close(); } catch {}
  }
}

module.exports = { renderBrokerage, renderHtml, closeBrowser };