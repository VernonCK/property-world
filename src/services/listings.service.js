'use strict';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 9;

const KNOWN_AMENITIES = [
  'Pool','Garden','Terrace','Garage','Fireplace','Oceanfront',
  'Waterfront','City View','Fitness Center','Modern','New Build'
];

class ListingService {
  constructor(db) {
    this.db = db;
  }

  /* ============================================================
     PUBLIC: Search
     ============================================================ */
  async search(params) {
    const opts = this._normalizeParams(params);
    const [pageRows, total, facets] = await Promise.all([
      this._fetchPage(opts),
      this._fetchCount(opts),
      this._fetchFacets(opts.mode)
    ]);
    const listings = await this._hydrate(pageRows);
    let promoted = null;
    if (opts.page === 1) {
      const promotedRow = await this._fetchTopPromoted(opts);
      if (promotedRow) promoted = (await this._hydrate([promotedRow]))[0];
    }
    return {
      listings, promoted, total,
      page: opts.page, limit: opts.limit, mode: opts.mode,
      facets
    };
  }

  /* ============================================================
     PUBLIC: Detail — the single-listing page
     ============================================================ */
  async getById(id) {
    /* Permissive: a shared link should render any non-draft, non-withdrawn
       listing. The frontend keys off `status` to gate CTAs. */
    const [rows] = await this.db.pool.execute(
      `SELECT * FROM listings WHERE id = ? AND status NOT IN ('draft','withdrawn') LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;

    const listing = (await this._hydrate(rows))[0];

    const [offerCountRows] = await this.db.pool.execute(
      `SELECT COUNT(*) AS n FROM offers WHERE listing_id = ? AND status = 'active'`,
      [id]
    );
    listing.active_offers_count = Number(offerCountRows[0]?.n || 0);
    listing.is_accepting_offers   = ['live', 'on_offer'].includes(listing.status);
    listing.is_accepting_viewings = ['live', 'on_offer', 'under_contract'].includes(listing.status);

    return listing;
  }

  /* ============================================================
     PUBLIC: Offers list (active verified only, amount desc)
     ============================================================ */
  async getOffers(listingId) {
    const [rows] = await this.db.pool.execute(
      `SELECT id, ref, amount, currency, bidder_name, type, institution,
              submitted_at, expires_at
       FROM offers
       WHERE listing_id = ? AND status = 'active'
       ORDER BY amount DESC, submitted_at ASC`,
      [listingId]
    );
    return rows.map((r, i) => ({
      id: r.id,
      ref: r.ref,
      amount: r.amount,
      currency: r.currency,
      bidder_name: r.bidder_name,
      type: r.type,
      institution: r.institution,
      submitted_at: r.submitted_at,
      expires_at: r.expires_at,
      is_top: i === 0
    }));
  }

  /* ============================================================
     PUBLIC: Recommendations (same country / type / price band)
     ============================================================ */
  async getRecommendations(listingId, limit = 4) {
    const [srcRows] = await this.db.pool.execute(
      `SELECT id, country, type, price FROM listings WHERE id = ?`,
      [listingId]
    );
    if (!srcRows.length) return [];
    const src = srcRows[0];
    const hasPrice = src.price != null && Number(src.price) > 0;
    const priceLow  = hasPrice ? Math.floor(src.price * 0.7) : 0;
    const priceHigh = hasPrice ? Math.ceil(src.price * 1.3)  : 0;

    const sql = `
      SELECT l.*,
        (CASE WHEN l.country = ? THEN 1 ELSE 0 END) AS _country_match,
        (CASE WHEN l.type    = ? THEN 1 ELSE 0 END) AS _type_match
      FROM listings l
      WHERE l.status = 'live' AND l.id != ?
        AND (
          l.country = ? OR l.type = ?
          ${hasPrice ? 'OR (l.price IS NOT NULL AND l.price BETWEEN ? AND ?)' : ''}
        )
      ORDER BY _country_match DESC, _type_match DESC,
               ABS(COALESCE(l.price, 0) - ?) ASC,
               l.updated_at DESC
      LIMIT ?
    `;
    const params = hasPrice
      ? [src.country, src.type, listingId, src.country, src.type,
         priceLow, priceHigh, src.price || 0, limit]
      : [src.country, src.type, listingId, src.country, src.type,
         src.price || 0, limit];

    const [rows] = await this.db.pool.execute(sql, params);
    return await this._hydrate(rows);
  }

  /* ============================================================
     PUBLIC: Submit competing offer
     ============================================================ */
  async createOffer(listingId, data) {
    const listing = await this.db.fetchById('listings', listingId);
    if (!listing) throw this._err(404, 'Listing not found', 'not_found');
    if (!['live', 'on_offer'].includes(listing.status)) {
      throw this._err(422, 'This listing is not accepting offers', 'not_accepting_offers');
    }

    const amount = parseInt(data.amount, 10);
    if (!amount || amount <= 0) throw this._err(422, 'A valid amount is required', 'validation_error');
    if (!data.bidder_name || !String(data.bidder_name).trim()) {
      throw this._err(422, 'Name is required', 'validation_error');
    }
    const type = data.type === 'financing' ? 'financing' : 'cash';
    if (type === 'financing' && !data.institution?.trim()) {
      throw this._err(422, 'Institution is required for financing offers', 'validation_error');
    }

    /* Must beat the current highest active offer, if any */
    const [topRows] = await this.db.pool.execute(
      `SELECT MAX(amount) AS max FROM offers WHERE listing_id = ? AND status = 'active'`,
      [listingId]
    );
    const highest = Number(topRows[0]?.max || 0);
    if (highest > 0 && amount <= highest) {
      throw this._err(422, `Offer must exceed the current highest offer (${highest})`, 'offer_too_low');
    }

    const ref = this._ref('PW-OFR');
    const expiresAt = data.expires_at
      ? new Date(data.expires_at)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const { insertId } = await this.db.insert('offers', {
      ref,
      listing_id: listingId,
      amount,
      currency: data.currency || listing.currency || 'BWP',
      type,
      institution: type === 'financing' ? String(data.institution).trim() : null,
      bidder_name: String(data.bidder_name).trim(),
      bidder_email: data.bidder_email ? String(data.bidder_email).trim() : null,
      bidder_phone: data.bidder_phone ? String(data.bidder_phone).trim() : null,
      submitted_via: 'frontend',
      status: 'pending_verification',
      expires_at: expiresAt,
      source: 'public listing page'
    });

    return { id: insertId, ref, status: 'pending_verification' };
  }

  /* ============================================================
     PUBLIC: Book a viewing (creates VAS request, service=viewing)
     ============================================================ */
  async createViewing(listingId, data) {
    const listing = await this.db.fetchById('listings', listingId);
    if (!listing) throw this._err(404, 'Listing not found', 'not_found');
    if (!['live', 'on_offer', 'under_contract'].includes(listing.status)) {
      throw this._err(422, 'This listing is not accepting viewings', 'not_accepting_viewings');
    }
    if (!data.name?.trim() || !data.email?.trim() || !data.preferred_date) {
      throw this._err(422, 'Name, email and preferred date are required', 'validation_error');
    }
    const payload = {
      listing_id: listingId,
      listing_title: listing.title,
      preferred_date: data.preferred_date,
      time_slot: data.time_slot || 'morning',
      tour_type: data.tour_type || 'in-person',
      notes: data.notes || null,
      contact: {
        name:  String(data.name).trim(),
        email: String(data.email).trim(),
        phone: data.phone ? String(data.phone).trim() : null
      }
    };
    const summary = `Viewing request: ${listing.title} — ${data.preferred_date} (${data.time_slot || 'morning'})`.slice(0, 500);

    return await this._createVasAndRoute({
      service: 'viewing',
      listingId,
      submitterName:  payload.contact.name,
      submitterEmail: payload.contact.email,
      submitterPhone: payload.contact.phone,
      summary,
      payload
    });
  }

  /* ============================================================
     PUBLIC: Contact agent (creates VAS, service=brokerage)
     ============================================================ */
  async createInquiry(listingId, data) {
    const listing = await this.db.fetchById('listings', listingId);
    if (!listing) throw this._err(404, 'Listing not found', 'not_found');
    if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
      throw this._err(422, 'Name, email and message are required', 'validation_error');
    }
    const payload = {
      listing_id: listingId,
      listing_title: listing.title,
      message: String(data.message).trim(),
      contact: {
        name:  String(data.name).trim(),
        email: String(data.email).trim(),
        phone: data.phone ? String(data.phone).trim() : null
      }
    };
    const summary = `Inquiry: ${listing.title}`.slice(0, 500);

    return await this._createVasAndRoute({
      service: 'brokerage',
      listingId,
      submitterName:  payload.contact.name,
      submitterEmail: payload.contact.email,
      submitterPhone: payload.contact.phone,
      summary,
      payload
    });
  }

  /* ============================================================
     PUBLIC: Subscribe to offer/price events
     ============================================================ */
  async createSubscription(listingId, data) {
    const listing = await this.db.fetchById('listings', listingId);
    if (!listing) throw this._err(404, 'Listing not found', 'not_found');
    if (!data.email?.trim()) throw this._err(422, 'Email is required', 'validation_error');

    const email = String(data.email).trim();
    const name  = data.name?.trim() || null;
    const prefs = Array.isArray(data.prefs) ? data.prefs.filter(Boolean) : [];

    const [existing] = await this.db.pool.execute(
      `SELECT id FROM offer_subscriptions WHERE listing_id = ? AND email = ? LIMIT 1`,
      [listingId, email]
    );
    if (existing.length) {
      await this.db.update('offer_subscriptions',
        { name, prefs: JSON.stringify(prefs) },
        { id: existing[0].id }
      );
      return { id: existing[0].id };
    }
    const { insertId } = await this.db.insert('offer_subscriptions', {
      listing_id: listingId,
      name,
      email,
      prefs: JSON.stringify(prefs)
    });
    return { id: insertId };
  }

  /* ============================================================
     PRIVATE: VAS creation + routing
     ============================================================ */
  async _createVasAndRoute({ service, listingId, submitterName, submitterEmail, submitterPhone, summary, payload }) {
    const [ruleRows] = await this.db.pool.execute(
      `SELECT * FROM routing_rules WHERE service = ? LIMIT 1`,
      [service]
    );
    const rule = ruleRows[0] || null;

    let assigneeId = null;
    let slaHours = 24;
    let autoAssign = true;
    let routingStrategy = 'primary';

    if (rule) {
      slaHours        = rule.sla_hours || 24;
      autoAssign      = !!rule.auto_assign;
      routingStrategy = rule.routing_strategy || 'primary';

      if (routingStrategy === 'listing_agent' && listingId) {
        const listing = await this.db.fetchById('listings', listingId);
        if (listing?.assigned_user_id) assigneeId = listing.assigned_user_id;
      }
      if (!assigneeId && rule.primary_user_id) assigneeId = rule.primary_user_id;
    }

    const ref = this._vasRef(service);
    const now = new Date();
    const slaDueAt = new Date(now.getTime() + slaHours * 3600 * 1000);
    const status = (autoAssign && assigneeId) ? 'assigned' : 'pending';
    const assignedAt = status === 'assigned' ? now : null;

    const { insertId } = await this.db.insert('vas_requests', {
      ref,
      service,
      status,
      priority: 'normal',
      submitter_name: submitterName,
      submitter_email: submitterEmail,
      submitter_phone: submitterPhone,
      summary,
      payload: JSON.stringify(payload),
      listing_id: listingId,
      assigned_user_id: assigneeId,
      source: 'frontend',
      assigned_at: assignedAt,
      sla_due_at: slaDueAt
    });

    try {
      await this.db.insert('vas_activity', {
        request_id: insertId,
        type: 'created',
        detail: 'Submitted from public listing page'
      });
      if (assigneeId) {
        await this.db.insert('vas_activity', {
          request_id: insertId,
          type: 'assigned',
          actor_user_id: null,
          detail: `Auto-assigned via ${routingStrategy} routing`
        });
      }
    } catch (err) {
      console.warn('[VAS activity log]', err.message);
    }

    return { request_id: insertId, ref };
  }

  /* ============================================================
     PRIVATE: hydrate + groups
     ============================================================ */
  async _hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const agentIds = [...new Set(rows.map(r => r.assigned_user_id).filter(Boolean))];

    const [photoRows, agentRows] = await Promise.all([
      this.db.pool.execute(
        `SELECT lp.id, lp.listing_id, lp.url, lp.category_id, lp.sort_order,
                pc.slug AS category_slug, pc.name AS category_name, pc.sort_order AS category_sort_order
         FROM listing_photos lp
         LEFT JOIN photo_categories pc ON pc.id = lp.category_id
         WHERE lp.listing_id IN (${ids.map(() => '?').join(',')})
         ORDER BY lp.listing_id ASC, pc.sort_order ASC, lp.sort_order ASC`,
        ids
      ),
      agentIds.length
        ? this.db.pool.execute(
            `SELECT id, name, role, title, photo_url, email, phone
             FROM users WHERE id IN (${agentIds.map(() => '?').join(',')})`,
            agentIds
          )
        : Promise.resolve([[]])
    ]);

    const photosByListing = new Map();
    for (const p of photoRows[0]) {
      if (!photosByListing.has(p.listing_id)) photosByListing.set(p.listing_id, []);
      photosByListing.get(p.listing_id).push({
        id: p.id,
        url: p.url,
        category_id: p.category_id,
        category_slug: p.category_slug,
        category_name: p.category_name || 'Other',
        category_sort_order: p.category_sort_order ?? 999,
        sort_order: p.sort_order
      });
    }
    const agentById = new Map(agentRows[0].map(a => [a.id, a]));

    return rows.map(r => {
      let features = r.features;
      if (typeof features === 'string') {
        try { features = JSON.parse(features); } catch { features = null; }
      }
      const photos = photosByListing.get(r.id) || [];
      const agent = r.assigned_user_id ? agentById.get(r.assigned_user_id) : null;
      return {
        id: r.id,
        ref: r.ref,
        title: r.title,
        description: r.description,
        category: r.category,
        type: r.type,
        mode: r.mode,
        price: r.price,
        currency: r.currency,
        country: r.country,
        city: r.city,
        region: r.region,
        beds: r.beds,
        baths: r.baths,
        sqm: r.sqm,
        features,
        status: r.status,
        mandate: r.mandate,
        promoted: !!r.promoted,
        new_build: !!r.new_build,
        views: r.views || 0,
        inquiries: r.inquiries || 0,
        cover_url: photos[0]?.url || null,
        photos: photos.map(p => ({
          id: p.id,
          url: p.url,
          category_id: p.category_id,
          category_slug: p.category_slug,
          category_name: p.category_name,
          sort_order: p.sort_order
        })),
        photo_groups: this._groupPhotos(photos),
        video_url: r.video_url || null,
        video_public_id: r.video_public_id || null,
        agent: agent ? {
          id: agent.id, name: agent.name, role: agent.role, title: agent.title,
          photo_url: agent.photo_url, email: agent.email, phone: agent.phone
        } : null,
        created_at: r.created_at,
        updated_at: r.updated_at
      };
    });
  }

  _groupPhotos(photos) {
    if (!photos || !photos.length) return [];
    const groups = [];
    let current = null;
    for (const p of photos) {
      if (!current || current.category.id !== p.category_id) {
        current = {
          category: {
            id: p.category_id,
            slug: p.category_slug,
            name: p.category_name,
            sort_order: p.category_sort_order
          },
          photos: []
        };
        groups.push(current);
      }
      current.photos.push({ id: p.id, url: p.url, sort_order: p.sort_order });
    }
    return groups;
  }

  /* ============================================================
     PRIVATE: params / where / facets / fetchers
     ============================================================ */
  _normalizeParams(p) {
    const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const toArr = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean);
      return String(v).split(',').map(s => s.trim()).filter(Boolean);
    };
    return {
      q: typeof p.q === 'string' ? p.q.trim() : '',
      mode: p.mode === 'rent' ? 'rent' : 'buy',
      category: typeof p.category === 'string' && p.category !== 'all' ? p.category : null,
      types: toArr(p.type),
      price_min: toInt(p.price_min),
      price_max: toInt(p.price_max),
      beds: toInt(p.beds) || 0,
      amenities: toArr(p.amenities),
      new_build: p.new_build === '1' || p.new_build === 'true' || p.new_build === true,
      country: typeof p.country === 'string' ? p.country : null,
      city: typeof p.city === 'string' ? p.city : null,
      sort: ['premium','recent','price_asc','price_desc','living_area_desc','living_area_asc'].includes(p.sort) ? p.sort : 'premium',
      page: Math.max(1, toInt(p.page) || 1),
      limit: Math.min(MAX_LIMIT, Math.max(1, toInt(p.limit) || DEFAULT_LIMIT))
    };
  }

  _buildWhere(opts) {
    const cond = ['l.status = ?', 'l.mode = ?'];
    const params = ['live', opts.mode];

    if (opts.category) { cond.push('l.category = ?'); params.push(opts.category); }
    if (opts.types.length) {
      cond.push(`l.type IN (${opts.types.map(() => '?').join(',')})`);
      params.push(...opts.types);
    }
    if (opts.price_min != null) { cond.push('l.price >= ?'); params.push(opts.price_min); }
    if (opts.price_max != null) { cond.push('l.price <= ?'); params.push(opts.price_max); }
    if (opts.beds > 0) { cond.push('l.beds >= ?'); params.push(opts.beds); }
    if (opts.new_build) { cond.push('l.new_build = 1'); }
    if (opts.country) { cond.push('l.country = ?'); params.push(opts.country); }
    if (opts.city) { cond.push('l.city = ?'); params.push(opts.city); }
    if (opts.region) { cond.push('l.region = ?'); params.push(opts.region); }
    
    if (opts.q) {
      const like = `%${opts.q}%`;
      cond.push('(l.title LIKE ? OR l.description LIKE ? OR l.city LIKE ? OR l.region LIKE ? OR l.country LIKE ? OR l.ref LIKE ?)');
      params.push(like, like, like, like, like, like);
    }
    for (const a of opts.amenities) {
      cond.push("JSON_CONTAINS(l.features, ?, '$.amenities')");
      params.push(JSON.stringify(a));
    }
    return { sql: 'WHERE ' + cond.join(' AND '), params };
  }

  _buildOrderBy(sort) {
    const map = {
      premium: 'l.promoted DESC, l.updated_at DESC',
      recent: 'l.updated_at DESC',
      price_asc: 'l.price IS NULL, l.price ASC',
      price_desc: 'l.price IS NULL, l.price DESC',
      living_area_desc: 'l.sqm DESC',
      living_area_asc: 'l.sqm ASC'
    };
    return 'ORDER BY ' + (map[sort] || map.premium);
  }

  async _fetchPage(opts) {
    const where = this._buildWhere(opts);
    const sql = `SELECT l.* FROM listings l ${where.sql} ${this._buildOrderBy(opts.sort)} LIMIT ? OFFSET ?`;
    const offset = (opts.page - 1) * opts.limit;
    const [rows] = await this.db.pool.execute(sql, [...where.params, opts.limit, offset]);
    return rows;
  }

  async _fetchCount(opts) {
    const where = this._buildWhere(opts);
    const [rows] = await this.db.pool.execute(
      `SELECT COUNT(*) AS n FROM listings l ${where.sql}`,
      where.params
    );
    return Number(rows[0]?.n || 0);
  }

  async _fetchTopPromoted(opts) {
    const where = this._buildWhere(opts);
    const sql = `SELECT l.* FROM listings l ${where.sql} AND l.promoted = 1 ${this._buildOrderBy(opts.sort)} LIMIT 1`;
    const [rows] = await this.db.pool.execute(sql, where.params);
    return rows[0] || null;
  }

  async _fetchFacets(mode) {
    const [categories, types, countries, amenities] = await Promise.all([
      this.db.pool.execute(
        `SELECT category AS value, COUNT(*) AS count FROM listings WHERE status='live' AND mode=? AND category IS NOT NULL GROUP BY category ORDER BY count DESC`,
        [mode]
      ),
      this.db.pool.execute(
        `SELECT type AS value, COUNT(*) AS count FROM listings WHERE status='live' AND mode=? AND type IS NOT NULL GROUP BY type ORDER BY count DESC`,
        [mode]
      ),
      this.db.pool.execute(
        `SELECT country AS value, COUNT(*) AS count FROM listings WHERE status='live' AND mode=? AND country IS NOT NULL GROUP BY country ORDER BY count DESC`,
        [mode]
      ),
      this._fetchAmenityFacets(mode)
    ]);
    return {
      categories: categories[0].map(r => ({ value: r.value, count: Number(r.count) })),
      types: types[0].map(r => ({ value: r.value, count: Number(r.count) })),
      countries: countries[0].map(r => ({ value: r.value, count: Number(r.count) })),
      amenities
    };
  }

  async _fetchAmenityFacets(mode) {
    const parts = KNOWN_AMENITIES.map(() =>
      `SELECT ? AS value, COUNT(*) AS count FROM listings WHERE status='live' AND mode=? AND JSON_CONTAINS(features, ?, '$.amenities')`
    );
    const params = [];
    for (const a of KNOWN_AMENITIES) params.push(a, mode, JSON.stringify(a));
    const [rows] = await this.db.pool.execute(parts.join(' UNION ALL '), params);
    return rows
      .filter(r => Number(r.count) > 0)
      .map(r => ({ value: r.value, count: Number(r.count) }))
      .sort((a, b) => b.count - a.count);
  }

  /* ============================================================
     PRIVATE: refs & errors
     ============================================================ */
  _ref(prefix) {
    const y = new Date().getFullYear();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${y}-${rand}`;
  }

  _vasRef(service) {
    const map = {
      viewing: 'PW-VEW',
      brokerage: 'PW-LST',
      valuation: 'PW-VAL',
      'property-management': 'PW-PMG',
      'investment-consultancy': 'PW-CON',
      'project-management': 'PW-PRJ'
    };
    return this._ref(map[service] || 'PW-VAS');
  }

  _err(status, message, code) {
    const e = new Error(message);
    e.status = status;
    e.code = code;
    return e;
  }
}

module.exports = ListingService;