'use strict';

const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');
const config = require('../config');
const pdf = require('./instruction-pdf.service');
const uploads = require('../uploads/uploads');

const TEMPLATE_DIR = path.resolve(config.paths.pdfTemplates, 'valuation');
let _templateCache = null;

async function loadTemplate() {
  if (_templateCache) return _templateCache;
  const source = await fs.readFile(path.join(TEMPLATE_DIR, 'instruction.html'), 'utf8');
  _templateCache = Handlebars.compile(source);
  return _templateCache;
}

const REQUIRED_FIELDS = {
  name: 'Name / company',
  phone: 'Phone number',
  email: 'Email address',
  postalAddress: 'Postal address',
  lotNumber: 'Lot number',
  physicalLocation: 'Physical location',
  purpose: 'Purpose of valuation',
  signature: 'Signature'
};

function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try { return JSON.parse(v); } catch { return []; }
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function validate(body) {
  const errors = [];
  for (const [key, label] of Object.entries(REQUIRED_FIELDS)) {
    if (!String(body[key] || '').trim()) {
      errors.push({ field: key, message: `${label} is required` });
    }
  }
  if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))) {
    errors.push({ field: 'email', message: 'Enter a valid email address' });
  }
  const basis = toArray(body.basis);
  if (basis.length === 0) {
    errors.push({ field: 'basis', message: 'At least one valuation basis is required' });
  }
  if (String(body.agree) !== 'true') {
    errors.push({ field: 'agree', message: 'You must accept the terms' });
  }
  return errors;
}

function generateRef() {
  const y = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PW-VAL-${y}-${rand}`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtBwp(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ');
}

function buildTemplateData(body) {
  const basis = toArray(body.basis);
  return {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    postalAddress: String(body.postalAddress || '').trim(),
    lotNumber: String(body.lotNumber || '').trim(),
    extension: String(body.extension || '').trim(),
    physicalLocation: String(body.physicalLocation || '').trim(),
    contactPerson: String(body.contactPerson || '').trim(),
    contactMobile: String(body.contactMobile || '').trim(),
    basis: basis.join(', '),
    purpose: String(body.purpose || '').trim(),
    bank: String(body.bank || '').trim() || null,
    capacity: String(body.capacity || '').trim() || 'Director',
    deposit: fmtBwp(body.deposit),
    signature: String(body.signature || '').trim(),
    date: today()
  };
}

function buildPayload(body, uploadedFile) {
  const basis = toArray(body.basis);
  return {
    applicant: {
      name: String(body.name || '').trim(),
      phone: String(body.phone || '').trim(),
      email: String(body.email || '').trim(),
      postalAddress: String(body.postalAddress || '').trim()
    },
    property: {
      lotNumber: String(body.lotNumber || '').trim(),
      extension: String(body.extension || '').trim(),
      physicalLocation: String(body.physicalLocation || '').trim(),
      location: body.location === 'outside' ? 'outside' : 'gaborone',
      distance: parseInt(body.distance, 10) || 0
    },
    access: {
      contactPerson: String(body.contactPerson || '').trim() || null,
      contactMobile: String(body.contactMobile || '').trim() || null
    },
    scope: {
      basis,
      purpose: String(body.purpose || '').trim(),
      bank: String(body.bank || '').trim() || null,
      capacity: String(body.capacity || '').trim() || 'Director'
    },
    fees: {
      deposit: parseInt(body.deposit, 10) || 1500,
      travelEstimate: parseFloat(body.travelEstimate) || 0
    },
    attachments: uploadedFile ? [{
      name: uploadedFile.name,
      url: uploadedFile.url,
      type: uploadedFile.type,
      size: uploadedFile.size
    }] : []
  };
}

class ValuationService {
  constructor(db) { this.db = db; }

  async submit(body, file) {
    const errors = validate(body);
    if (!file) {
      errors.push({ field: 'proof_of_payment', message: 'Proof of payment is required' });
    }
    if (errors.length) {
      const e = new Error('Validation failed');
      e.status = 422;
      e.code = 'validation_error';
      e.fields = errors;
      throw e;
    }

    const reference = generateRef();

    /* 1. Upload proof of payment to Cloudinary */
    let proofUpload;
    try {
      const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image';
      proofUpload = await uploads.uploadBuffer(file.buffer, {
        folder: 'pw/vas/valuation/proofs',
        publicId: `${reference}-proof`,
        resourceType
      });
    } catch (err) {
      console.error('[valuation] proof upload failed:', err);
      const e = new Error('Proof-of-payment upload failed. Please try again or email valuations@pw.co.bw');
      e.status = 500;
      e.code = 'proof_upload_failed';
      throw e;
    }

    /* 2. Render the signed instruction PDF */
    const tplData = buildTemplateData(body);
    let pdfBuffer;
    try {
      const template = await loadTemplate();
      const html = template(tplData);
      const { renderHtml } = require('./instruction-pdf.service');
      pdfBuffer = await renderHtml(html);
    } catch (err) {
      console.error('[valuation] PDF render failed:', err);
      const e = new Error('PDF generation failed. Please try again or email valuations@pw.co.bw');
      e.status = 500;
      e.code = 'pdf_generation_failed';
      throw e;
    }

    /* 3. Upload PDF */
    let pdfUpload;
    try {
      pdfUpload = await uploads.uploadPdf(pdfBuffer, {
        folder: 'pw/vas/valuation',
        publicId: reference
      });
    } catch (err) {
      console.error('[valuation] PDF upload failed:', err);
      const e = new Error('PDF upload failed. Please try again or email valuations@pw.co.bw');
      e.status = 500;
      e.code = 'pdf_upload_failed';
      throw e;
    }

    /* 4. Routing */
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = 'valuation' LIMIT 1`
    );
    const rule = ruleRows[0] || null;
    const assigneeId = rule?.primary_user_id || null;
    const slaHours = rule?.sla_hours || 24;
    const autoAssign = !!rule?.auto_assign;
    const now = new Date();
    const slaDueAt = new Date(now.getTime() + slaHours * 3600 * 1000);
    const status = (autoAssign && assigneeId) ? 'assigned' : 'pending';

    /* 5. Insert vas_requests */
    const summary = `Valuation — Lot ${body.lotNumber}${body.extension ? ' · ' + body.extension : ''} — ${body.purpose}`.slice(0, 500);
    const { insertId } = await this.db.insert('vas_requests', {
      ref: reference,
      service: 'valuation',
      status,
      priority: 'normal',
      submitter_name: String(body.name).trim(),
      submitter_email: String(body.email).trim(),
      submitter_phone: String(body.phone).trim(),
      company: null,
      summary,
      payload: JSON.stringify(buildPayload(body, {
        name: file.originalname,
        url: proofUpload.url,
        type: file.mimetype,
        size: `${Math.round(file.size / 1024)} KB`
      })),
      listing_id: null,
      attachments: JSON.stringify([{
        name: file.originalname,
        url: proofUpload.url,
        type: file.mimetype,
        size: `${Math.round(file.size / 1024)} KB`
      }]),
      pdf_url: pdfUpload.url,
      pdf_public_id: pdfUpload.publicId,
      assigned_user_id: assigneeId,
      source: 'frontend',
      assigned_at: status === 'assigned' ? now : null,
      sla_due_at: slaDueAt
    });

    /* 6. Activity */
    try {
      await this.db.insert('vas_activity', {
        request_id: insertId,
        type: 'created',
        detail: 'Submitted from public valuation page'
      });
      if (assigneeId && status === 'assigned') {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: 'Auto-assigned to primary valuation user'
        });
      }
    } catch (err) {
      console.warn('[valuation] activity log failed:', err.message);
    }

    return { id: insertId, ref: reference, status, pdf_url: pdfUpload.url };
  }
}

module.exports = ValuationService;