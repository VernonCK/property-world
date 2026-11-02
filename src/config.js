'use strict';

require('dotenv').config();

function req(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`[config] Missing required env var: ${name}`);
  }
  return v;
}

function opt(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`[config] ${name} must be a number`);
  return n;
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = Object.freeze({
  env: opt('NODE_ENV', 'development'),
  logLevel: opt('LOG_LEVEL', 'info'),

  front: {
    port: num('FRONT_PORT', 3000),
    baseUrl: opt('APP_BASE_URL', 'http://localhost:3000'),
  },
  admin: {
    port: num('ADMIN_PORT', 3001),
    baseUrl: opt('ADMIN_BASE_URL', 'http://localhost:3001'),
  },

  db: {
    host: req('DB_HOST'),
    port: num('DB_PORT', 3306),
    user: req('DB_USER'),
    password: req('DB_PASSWORD'),
    database: req('DB_NAME'),
    poolSize: num('DB_POOL_SIZE', 10),
    timezone: opt('DB_TIMEZONE', 'Z'),
  },

  session: {
    secret: req('SESSION_SECRET'),
    cookieName: opt('SESSION_COOKIE_NAME', 'pw_sess'),
    ttlMs: num('SESSION_TTL_HOURS', 720) * 60 * 60 * 1000,
  },

  login: {
    codeLength: num('LOGIN_CODE_LENGTH', 6),
    ttlMinutes: num('LOGIN_CODE_TTL_MINUTES', 10),
    maxAttempts: num('LOGIN_CODE_MAX_ATTEMPTS', 5),
    resendSeconds: num('LOGIN_CODE_RESEND_SECONDS', 30),
  },

  smtp: {
    host: req('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: req('SMTP_USER'),
    password: req('SMTP_PASSWORD'),
    from: opt('SMTP_FROM', 'Property World <notifications@pw.co.bw>'),
    replyTo: opt('SMTP_REPLY_TO', 'hello@pw.co.bw'),
  },

  cloudinary: {
    cloudName: req('CLOUDINARY_CLOUD_NAME'),
    apiKey: req('CLOUDINARY_API_KEY'),
    apiSecret: req('CLOUDINARY_API_SECRET'),
    folder: opt('CLOUDINARY_FOLDER', 'pw'),
  },

  facebook: {
    graphVersion: opt('FACEBOOK_GRAPH_VERSION', 'v22.0'),
    appId: opt('FACEBOOK_APP_ID', ''),
    appSecret: opt('FACEBOOK_APP_SECRET', ''),
    pageId: opt('FACEBOOK_PAGE_ID', ''),
    pageAccessToken: opt('FACEBOOK_PAGE_ACCESS_TOKEN', ''),
  },

  ai: {
    apiKey: opt('GROQ_API_KEY', ''),
    model: opt('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    baseUrl: opt('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
  },

  paths: {
    pdfTemplates: opt('PDF_TEMPLATES_DIR', './templates'),
    temp: opt('TEMP_DIR', './tmp'),
  },

  uploads: {
    maxBytes: num('MAX_UPLOAD_MB', 15) * 1024 * 1024,
  },
});

module.exports = config;