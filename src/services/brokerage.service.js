'use strict';

const pdf = require('./instruction-pdf.service');
const uploads = require('../uploads/uploads');

const REQUIRED_FIELDS = {
  plotNo: 'Plot number',
  ownerName: "Owner's name",
  contactName: 'Contact person',
  email: 'Email address',
  cell: 'Cell number',
  amountRequired: 'Amount required',
  signature: 'Signature'
};

function validate(data) {
  const errors = [];
  for (const [key, label] of Object.entries(REQUIRED_FIELDS)) {
    if (!String(data[key] || '').trim()) {
      errors.push({ field: key, message: `${label} is required` });
    }
  }
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email))) {
    errors.push({ field: 'email', message: 'Enter a valid email address' });
  }
  if (data.agree !== true) {
    errors.push({ field: 'agree', message: 'You must accept the terms' });
  }
  return errors;
}

function generateRef() {
  const y = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PW-LST-${y}-${rand}`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function yes(v) {
  return (v === true || v === 'true' || v === 1 || v === '1') ? 'Yes' : '';
}

function num(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function txnWord(txn) {
  if (txn === 'sale') return 'SELL';
  if (txn === 'lease') return 'LEASE';
  return 'SELL/LEASE';
}

function normalizePtype(ptype) { return ptype === 'commercial' ? 'commercial' : 'residential'; }
function normalizeMandate(m) { return m === 'sole' ? 'sole' : 'multiple'; }

function buildTemplateData(data) {
  const ptype = normalizePtype(data.ptype);
  const mandate = normalizeMandate(data.mandate);
  const f = data.features || {};
  const off = data.offices || null;
  const wh = data.warehouse || null;

  return {
    isCommercial: ptype === 'commercial',
    isSole: mandate === 'sole',
    isMultiple: mandate === 'multiple',
    txnWord: txnWord(data.txn),
    mandateMonths: data.months || data.mandateMonths || 3,
    date: today(),

    owner: {
      title: data.ownerTitle || '',
      name: data.ownerName || '',
      ownership: data.ownership || '',
      keysAccess: data.keysAccess || ''
    },
    contact: {
      title: data.contactTitle || '',
      name: data.contactName || '',
      cell: data.cell || '',
      telWork: data.telWork || '',
      telHome: data.telHome || '',
      fax: data.fax || '',
      email: data.email || '',
      postalAddress: data.postalAddress || ''
    },
    property: {
      plotNo: data.plotNo || '',
      extLocation: data.extLocation || '',
      plotSize: data.plotSize || '',
      availableDate: data.availableDate || data.availableDate2 || data.availableDate3 || '',
      otherDetails: data.otherDetails || ''
    },
    features: {
      bedrooms: num(f.bedrooms),
      bathrooms: num(f.bathrooms),
      showers: num(f.showers),
      garage: num(f.garage),
      carport: num(f.carport),
      aircons: num(f.aircons),
      scullery: yes(f.fScullery),
      masterEnsuite: yes(f.fMasterEnsuite),
      pantry: yes(f.fPantry),
      guestToilet: yes(f.fGuestToilet),
      staffQuarters: yes(f.fStaffQuarters),
      lounge: yes(f.fLounge),
      pool: yes(f.fPool),
      dining: yes(f.fDining),
      familyRoom: yes(f.fFamilyRoom),
      gardens: yes(f.fGardens),
      study: yes(f.fStudy),
      securitySystem: yes(f.fSecurity),
      fittedKitchen: yes(f.fFittedKitchen),
      electricFence: yes(f.fElectricFence),
      guestWing: yes(f.fGuestWing),
      automatedGate: yes(f.fAutoGate)
    },
    offices: off ? {
      size: off.size || '',
      plotSize: off.plotSize || '',
      toilets: off.toilets || '',
      kitchens: off.kitchens || '',
      airCon: yes(off.ac),
      carpet: yes(off.carpet),
      ceramic: yes(off.ceramic)
    } : null,
    warehouses: wh ? {
      size: wh.size || '',
      plotSize: wh.plotSize || '',
      loadingDoors: wh.loadingDoors || '',
      offices: wh.offices || '',
      toilets: wh.toilets || '',
      kitchen: yes(wh.kitchen)
    } : null,
    pricing: {
      amountRequired: data.amountRequired || '',
      ratePerSqm: data.ratePerSqm || '',
      otherCharges: data.otherCharges || '',
      currency: data.currency || 'BWP'
    },
    signature: data.signature || ''
  };
}

function buildPayload(data) {
  const ptype = normalizePtype(data.ptype);
  const mandate = normalizeMandate(data.mandate);
  return {
    txn: data.txn,
    ptype,
    mandate,
    mandateMonths: data.months || data.mandateMonths || 3,
    plotNo: data.plotNo,
    extLocation: data.extLocation || null,
    residential: ptype === 'residential' ? {
      plotSize: data.plotSize || null,
      availableDate: data.availableDate || data.availableDate2 || null,
      features: data.features || null
    } : null,
    commercial: ptype === 'commercial' ? {
      offices: data.offices || null,
      warehouses: data.warehouse || null
    } : null,
    otherDetails: data.otherDetails || null,
    owner: {
      title: data.ownerTitle || '',
      name: data.ownerName,
      ownership: data.ownership || null,
      keysAccess: data.keysAccess || null
    },
    contact: {
      title: data.contactTitle || '',
      name: data.contactName,
      cell: data.cell,
      telWork: data.telWork || null,
      telHome: data.telHome || null,
      fax: data.fax || null,
      email: data.email,
      postalAddress: data.postalAddress || null
    },
    pricing: {
      amountRequired: data.amountRequired,
      ratePerSqm: data.ratePerSqm || null,
      otherCharges: data.otherCharges || null,
      currency: data.currency || 'BWP'
    },
    agreement: {
      signature: data.signature,
      signedAt: new Date().toISOString()
    }
  };
}

class BrokerageService {
  constructor(db) { this.db = db; }

  async submit(data) {
    const errors = validate(data);
    if (errors.length) {
      const e = new Error('Validation failed');
      e.status = 422;
      e.code = 'validation_error';
      e.fields = errors;
      throw e;
    }

    const reference = generateRef();
    const tplData = buildTemplateData(data);

    /* 1. Render PDF */
    let pdfBuffer;
    try {
      pdfBuffer = await pdf.renderBrokerage({ data: tplData });
    } catch (err) {
      console.error('[brokerage] PDF render failed:', err);
      const e = new Error('PDF generation failed. Please try again or email brokerage@pw.co.bw');
      e.status = 500;
      e.code = 'pdf_generation_failed';
      throw e;
    }

    /* 2. Upload to Cloudinary (resource_type=raw for PDFs) */
    let upload;
    try {
      upload = await uploads.uploadPdf(pdfBuffer, {
        publicId: reference
      });
    } catch (err) {
      console.error('[brokerage] Cloudinary upload failed:', err);
      const e = new Error('PDF upload failed. Please try again or email brokerage@pw.co.bw');
      e.status = 500;
      e.code = 'pdf_upload_failed';
      throw e;
    }
 
    /* 3. Routing — no listing exists yet, so fall back to primary_user_id */
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = 'brokerage' LIMIT 1`
    );
    const rule = ruleRows[0] || null;
    const assigneeId = rule?.primary_user_id || null;
    const slaHours = rule?.sla_hours || 24;
    const autoAssign = !!rule?.auto_assign;

    const now = new Date();
    const slaDueAt = new Date(now.getTime() + slaHours * 3600 * 1000);
    const status = (autoAssign && assigneeId) ? 'assigned' : 'pending';

    /* 4. Insert vas_requests */
    const { insertId } = await this.db.insert('vas_requests', {
      ref: reference,
      service: 'brokerage',
      status,
      priority: 'normal',
      submitter_name: data.ownerName,
      submitter_email: data.email,
      submitter_phone: data.cell,
      company: null,
      summary: `Brokerage instruction — ${data.txn || 'sale/lease'} ${data.ptype || 'residential'} — Lot ${data.plotNo}`.slice(0, 500),
      payload: JSON.stringify(buildPayload(data)),
      listing_id: null,
      attachments: null,
      pdf_url: upload.url,
      pdf_public_id: upload.publicId,
      assigned_user_id: assigneeId,
      source: 'frontend',
      assigned_at: status === 'assigned' ? now : null,
      sla_due_at: slaDueAt
    });

    /* 5. Activity log — non-fatal if it fails */
    try {
      await this.db.insert('vas_activity', {
        request_id: insertId,
        type: 'created',
        detail: 'Submitted from public brokerage page'
      });
      if (assigneeId && status === 'assigned') {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: 'Auto-assigned to primary brokerage user'
        });
      }
    } catch (err) {
      console.warn('[brokerage] activity log failed:', err.message);
    }

    return { id: insertId, ref: reference, status, pdf_url: upload.url };
  }
}

module.exports = BrokerageService;