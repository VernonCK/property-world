'use strict';

const SECTORS = ['construction','education','sports','government','mining','architecture','other'];
const STAGES = ['planning','procurement','construction','closeout','review','strategy'];
const SERVICES = ['consultancy','outsourced','architecture-design','training','pmo','review','advise'];

const SECTOR_LABELS = {
  construction: 'Construction',
  education: 'Education',
  sports: 'Sports & civic',
  government: 'Government',
  mining: 'Mining',
  architecture: 'Architecture & design',
  other: 'Other'
};

const STAGE_LABELS = {
  planning: 'Planning / feasibility',
  procurement: 'Procurement / tendering',
  construction: 'Construction / execution',
  closeout: 'Closeout / commissioning',
  review: 'Review / audit',
  strategy: 'Strategy / advisory'
};

const SERVICE_LABELS = {
  consultancy: 'PM consultancy',
  outsourced: 'Outsourced PM',
  'architecture-design': 'Architectural design',
  training: 'Team training',
  pmo: 'PMO support / audit',
  review: 'Health review',
  advise: 'Advise me'
};

function generateRef() {
  const y = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PW-PRJ-${y}-${rand}`;
}

function validate(body) {
  const errors = [];
  const a = body.applicant || {};
  const p = body.project || {};

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
  if (!SECTORS.includes(p.sector)) {
    errors.push({ field: 'project.sector', message: 'Select a sector' });
  }
  if (!STAGES.includes(p.stage)) {
    errors.push({ field: 'project.stage', message: 'Select a project stage' });
  }
  const services = Array.isArray(body.services) ? body.services : [];
  const cleaned = services.filter(s => SERVICES.includes(s));
  if (cleaned.length === 0) {
    errors.push({ field: 'services', message: 'Select at least one service' });
  }
  return errors;
}

function buildPayload(body) {
  const a = body.applicant || {};
  const p = body.project || {};
  return {
    applicant: {
      name: String(a.name || '').trim(),
      company: String(a.company || '').trim() || null,
      email: String(a.email || '').trim(),
      phone: String(a.phone || '').trim()
    },
    project: {
      sector: p.sector,
      stage: p.stage,
      projectValue: String(p.projectValue || '').trim() || null,
      location: String(p.location || '').trim() || null
    },
    services: Array.isArray(body.services)
      ? body.services.filter(s => SERVICES.includes(s))
      : [],
    message: String(body.message || '').trim()
  };
}

function buildSummary(body) {
  const a = body.applicant || {};
  const p = body.project || {};
  const sector = SECTOR_LABELS[p.sector] || 'Project';
  const stage = STAGE_LABELS[p.stage] || '';
  const name = String(a.name || '').trim();
  return `${sector}${stage ? ' · ' + stage : ''} — ${name}`.slice(0, 500);
}

class ProjectManagementService {
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

    /* Route via routing_rules — project-management uses primary strategy */
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = 'project-management' LIMIT 1`
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
      service: 'project-management',
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
        detail: 'Submitted from public project management page'
      });
      if (assigneeId && status === 'assigned') {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: 'Auto-assigned to primary project management user'
        });
      }
    } catch (err) {
      console.warn('[project-management] activity log failed:', err.message);
    }

    return { id: insertId, ref: reference, status };
  }
}

module.exports = ProjectManagementService;