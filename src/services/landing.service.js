'use strict';

/**
 * LandingService — one call that returns everything the landing page needs.
 *
 * Composition:
 *   - team      → users where team_page=1 AND status='active'
 *   - stats     → marketing credentials (stable brand facts, not live counters)
 *   - featured  → top promoted live listing
 *   - gallery   → next 6 promoted live listings (excluding featured)
 *
 * Total queries: 3 (users, listings, listing_photos).
 */
class LandingService {
  constructor(db) {
    this.db = db;
  }

  async getContent() {
    const [team, { featured, gallery }] = await Promise.all([
      this._getTeam(),
      this._getFeaturedAndGallery()
    ]);

    return {
      team,
      stats: this._getStats(),
      featured,
      gallery
    };
  }

  /* ─── Team ──────────────────────────────────────────────────────── */
  async _getTeam() {
    const rows = await this.db.fetchAll('users', {
      where: { team_page: 1, status: 'active' },
      orderBy: { column: 'id', direction: 'ASC' },
      columns: ['id', 'name', 'email', 'role', 'title', 'tag', 'bio', 'photo_url']
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title || r.tag || this._roleLabel(r.role),
      tag: r.tag || '',
      role: r.role,
      photo_url: r.photo_url,
      bio: r.bio || '',
      email: r.email
    }));
  }

  _roleLabel(role) {
    return {
      super_admin: 'Managing Director',
      admin: 'Administrator',
      agent: 'Agent',
      viewer: 'Team Member'
    }[role] || 'Team Member';
  }

  /* ─── Featured + gallery (2 queries) ────────────────────────────── */
  async _getFeaturedAndGallery() {
    const rows = await this.db.fetchAll('listings', {
      where: [
        { column: 'status', op: '=', value: 'live' },
        { column: 'promoted', op: '=', value: 1 }
      ],
      orderBy: [
        { column: 'views', direction: 'DESC' },
        { column: 'updated_at', direction: 'DESC' }
      ],
      limit: 7,
      columns: ['id', 'ref', 'title', 'description', 'price', 'currency',
                'country', 'city', 'region', 'beds', 'baths', 'sqm']
    });

    if (rows.length === 0) return { featured: null, gallery: [] };

    /* Fetch all cover photos in one query, keyed by listing_id */
    const ids = rows.map((r) => r.id);
    const photos = await this.db.fetchAll('listing_photos', {
      where: [{ column: 'listing_id', op: 'IN', value: ids }],
      orderBy: [
        { column: 'listing_id', direction: 'ASC' },
        { column: 'sort_order', direction: 'ASC' }
      ],
      columns: ['listing_id', 'url']
    });
    const coverByListing = new Map();
    for (const p of photos) {
      if (!coverByListing.has(p.listing_id)) coverByListing.set(p.listing_id, p.url);
    }

    const shaped = rows.map((r) => this._shapeListing(r, coverByListing.get(r.id) || null));
    return {
      featured: shaped[0],
      gallery: shaped.slice(1, 7)
    };
  }

  _shapeListing(row, coverUrl) {
    return {
      id: row.id,
      ref: row.ref,
      title: row.title,
      description: row.description,
      price: row.price,
      currency: row.currency,
      country: row.country,
      city: row.city,
      region: row.region,
      beds: row.beds,
      baths: row.baths,
      sqm: row.sqm,
      cover_url: coverUrl
    };
  }

  /* ─── Marketing stats ───────────────────────────────────────────── */
  _getStats() {
    /* These are brand credentials, not live counters. Edit here if they change. */
    const establishedYear = 2005;
    return {
      established_year: establishedYear,
      years_of_counsel: 24,        // matches existing marketing copy ("24+")
      indemnity_bwp: 5000000,       // P5M professional indemnity (Hollard)
      bond_bwp: 4000000             // P4M bond capacity
    };
  }
}

module.exports = LandingService;