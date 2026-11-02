'use strict';

const INTERESTS = ['infrastructure','commercial','residential','multiple'];

const INTEREST_LABELS = {
  infrastructure: 'Infrastructure',
  commercial: 'Commercial developments',
  residential: 'Residential developments',
  multiple: 'Multiple sectors'
};

function generateRef() {
  const y = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PW-IC-${y}-${rand}`;
}

function validate(body) {
  const errors = [];
  const a = body.applicant || {};
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
  if (!INTERESTS.includes(body.interest)) {
    errors.push({ field: 'interest', message: 'Select an area of interest' });
  }
  if (!String(body.message || '').trim()) {
    errors.push({ field: 'message', message: 'Please describe the project' });
  }
  return errors;
}

function buildPayload(body) {
  const a = body.applicant || {};
  return {
    applicant: {
      name: String(a.name || '').trim(),
      company: String(a.company || '').trim() || null,
      email: String(a.email || '').trim(),
      phone: String(a.phone || '').trim()
    },
    interest: body.interest,
    message: String(body.message || '').trim()
  };
}

function buildSummary(body) {
  const a = body.applicant || {};
  const name = String(a.name || '').trim();
  const company = a.company ? ` (${String(a.company).trim()})` : '';
  const label = INTEREST_LABELS[body.interest] || 'Consultancy';
  return `${label} — ${name}${company}`.slice(0, 500);
}

class ConsultationService {
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

    /* Route via routing_rules — investment-consultancy uses primary strategy */
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = 'investment-consultancy' LIMIT 1`
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
      service: 'investment-consultancy',
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
        detail: 'Submitted from public investment consultancy page'
      });
      if (assigneeId && status === 'assigned') {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: 'Auto-assigned to primary consultancy user'
        });
      }
    } catch (err) {
      console.warn('[consultation] activity log failed:', err.message);
    }

    return { id: insertId, ref: reference, status };
  }
}

module.exports = ConsultationService;