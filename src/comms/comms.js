// src/comms/comms.js
'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

class Comms {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      pool: true,
      maxConnections: 3,
    });
    this.defaultFrom = config.smtp.from;
    this.defaultReplyTo = config.smtp.replyTo;
  }

  /** Verify the SMTP connection at boot. */
  async verify() {
    await this.transporter.verify();
  }

  /** Generic send. */
  async send({ to, subject, html, text, from, replyTo, cc, bcc, attachments }) {
    if (!to) throw new Error('comms.send: `to` is required');
    if (!subject) throw new Error('comms.send: `subject` is required');
    if (!html && !text) throw new Error('comms.send: provide `html` or `text`');

    const info = await this.transporter.sendMail({
      from: from || this.defaultFrom,
      replyTo: replyTo || this.defaultReplyTo,
      to,
      cc,
      bcc,
      subject,
      html,
      text: text || (html ? stripHtml(html) : undefined),
      attachments,
    });
    return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  }

  /** Passwordless login code. */
  async sendLoginCode({ email, code, name, ttlMinutes }) {
    const firstName = (name || '').split(/\s+/)[0] || 'there';
    const subject = `Your Property World sign-in code: ${code}`;
    const html = `
      <div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#151515">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:500;margin-bottom:24px">
          Property<span style="color:#245b98">World</span>
        </div>
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${escapeHtml(firstName)},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px">
          Use this code to sign in to the Property World admin console. It expires in ${ttlMinutes} minutes.
        </p>
        <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:600;
                    letter-spacing:8px;background:#eef3f9;color:#1c4a7d;padding:18px 24px;
                    border-radius:10px;text-align:center;margin:0 0 24px">
          ${escapeHtml(code)}
        </div>
        <p style="font-size:13px;line-height:1.6;color:#717171;margin:0 0 8px">
          If you didn't request this, you can safely ignore the email.
        </p>
        <p style="font-size:12px;line-height:1.6;color:#adadad;margin:24px 0 0;padding-top:16px;
                  border-top:1px solid #e0e0e0">
          Property World · Reg. CO.2005/826 · Gaborone, Botswana
        </p>
      </div>`;
    const text = `Hi ${firstName},\n\nYour Property World sign-in code is ${code}. It expires in ${ttlMinutes} minutes.\n\nIf you didn't request this, ignore this email.`;
    return this.send({ to: email, subject, html, text });
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = new Comms();