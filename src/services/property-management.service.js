'use strict';

const PROPERTY_TYPES = ['residential','commercial','industrial','sectional','mixed'];
const SITUATIONS = ['self-managed','currently-managed','newly-acquired','considering'];
const SERVICES = [
  'rent-collection',
  'tenant-management',
  'maintenance',
  'budgeting',
  'sectional-management',
  'value-advice',
  'improvements',
  'purchase-advice',
  'advise'
];

const PROPERTY_LABELS = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  sectional: 'Sectional title',
  mixed: 'Mixed portfolio'
};

function generateRef() {
  const y = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PW-PM-${y}-${rand}`;
}

function validate(body) {
  const errors = [];
  const a = body.applicant || {};
  const p = body.portfolio || {};

  if (!String(a.name || '').trim()) {
    errors.push({ field: 'applicant.name', message: 'Your name is required' });
  }
  if (!String(a.email || '').trim()) {
    errors.push({ field: 'applicant.email', message: 'Email is required' });
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a.email))) {
    errors.push({ field: 'applicant.email', message: 'Enter a valid email address' });
  }
  if (!String(a.phone || '').trim()) {
    errors.push({ field: 'applicant.phone', message: 'Phone number is required' });
  }

  const types = Array.isArray(p.propertyTypes) ? p.propertyTypes.filter(t => PROPERTY_TYPES.includes(t)) : [];
  if (types.length === 0) {
    errors.push({ field: 'portfolio.propertyTypes', message: 'Select at least one property type' });
  }

  const count = parseInt(p.propertyCount, 10);
  if (!Number.isFinite(count) || count < 1) {
    errors.push({ field: 'portfolio.propertyCount', message: 'Enter a property count of 1 or more' });
  }
  if (!String(p.location || '').trim()) {
    errors.push({ field: 'portfolio.location', message: 'Location is required' });
  }
  if (!SITUATIONS.includes(body.situation)) {
    errors.push({ field: 'situation', message: 'Select your current situation' });
  }
  const services = Array.isArray(body.services) ? body.services.filter(s => SERVICES.includes(s)) : [];
  if (services.length === 0) {
    errors.push({ field: 'services', message: 'Select at least one service' });
  }
  return errors;
}

function buildPayload(body) {
  const a = body.applicant || {};
  const p = body.portfolio || {};
  return {
    applicant: {
      name: String(a.name || '').trim(),
      company: String(a.company || '').trim() || null,
      email: String(a.email || '').trim(),
      phone: String(a.phone || '').trim()
    },
    portfolio: {
      propertyTypes: Array.isArray(p.propertyTypes)
        ? p.propertyTypes.filter(t => PROPERTY_TYPES.includes(t))
        : [],
      propertyCount: parseInt(p.propertyCount, 10) || 0,
      unitCount: parseInt(p.unitCount, 10) || 0,
      location: String(p.location || '').trim()
    },
    situation: body.situation,
    income: String(body.income || '').trim() || null,
    services: Array.isArray(body.services)
      ? body.services.filter(s => SERVICES.includes(s))
      : [],
    message: String(body.message || '').trim()
  };
}

function buildSummary(body) {
  const a = body.applicant || {};
  const p = body.portfolio || {};
  const types = (Array.isArray(p.propertyTypes) ? p.propertyTypes : [])
    .filter(t => PROPERTY_TYPES.includes(t))
    .map(t => PROPERTY_LABELS[t])
    .join(', ');
  const name = String(a.name || '').trim();
  const count = parseInt(p.propertyCount, 10) || 0;
  const location = String(p.location || '').trim();
  return `${types} · ${count} propert${count === 1 ? 'y' : 'ies'}${location ? ' · ' + location : ''} — ${name}`.slice(0, 500);
}

class PropertyManagementService {
  constructor(db) { this.db = db; }

  async submit(body) {
    const errors = validate(body);
    if (errors.length) {
      const e = new Error('Validation failed');
      e.status = 422;
      e.code = 'validation_error';
      e.fields = errors;
      throw e;
    }

    const applicant = body.applicant;
    const reference = generateRef();

    /* Route via routing_rules — property-management uses primary strategy */
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = 'property-management' LIMIT 1`
    );
    const rule = ruleRows[0] || null;
    const assigneeId = rule?.primary_user_id || null;
    const slaHours = rule?.sla_hours || 24;
    const autoAssign = !!rule?.auto_assign;

    const now = new Date();
    const slaDueAt = new Date(now.getTime() + slaHours * 3600 * 1000);
    const status = (autoAssign && assigneeId) ? 'assigned' : 'pending';

    const { insertId } = await this.db.insert('vas_requests', {
      ref: reference,
      service: 'property-management',
      status,
      priority: 'normal',
      submitter_name: String(applicant.name).trim(),
      submitter_email: String(applicant.email).trim(),
      submitter_phone: String(applicant.phone).trim(),
      company: String(applicant.company || '').trim() || null,
      summary: buildSummary(body),
      payload: JSON.stringify(buildPayload(body)),
      listing_id: null,
      attachments: null,
      pdf_url: null,
      pdf_public_id: null,
      assigned_user_id: assigneeId,
      source: 'frontend',
      assigned_at: status === 'assigned' ? now : null,
      sla_due_at: slaDueAt
    });

    try {
      await this.db.insert('vas_activity', {
        request_id: insertId,
        type: 'created',
        detail: 'Submitted from public property management page'
      });
      if (assigneeId && status === 'assigned') {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: 'Auto-assigned to primary property management user'
        });
      }
    } catch (err) {
      console.warn('[property-management] activity log failed:', err.message);
    }

    return { id: insertId, ref: reference, status };
  }
}

module.exports = PropertyManagementService;