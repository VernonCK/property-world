'use strict';

const config = require('../config');

const KNOWN_TYPES = ['Villa','House','Estate','Condo','Townhouse','Apartment','Penthouse','Office','Retail','Farm','Vineyard','Land'];
const KNOWN_AMENITIES = ['Pool','Garden','Terrace','Garage','Fireplace','Oceanfront','Waterfront','City View','Fitness Center','Modern','New Build'];
const KNOWN_CATEGORIES = ['Residential','Commercial','Agriculture','Land'];

let _locationsCache = null;
let _locationsExpiry = 0;

async function getLocations(db) {
  if (_locationsCache && Date.now() < _locationsExpiry) return _locationsCache;
  const [rows] = await db.pool.execute(
    `SELECT DISTINCT country, city, region FROM listings WHERE status = 'live'`
  );
  _locationsCache = {
    countries: [...new Set(rows.map(r => r.country).filter(Boolean))].sort(),
    cities:    [...new Set(rows.map(r => r.city).filter(Boolean))].sort(),
    regions:   [...new Set(rows.map(r => r.region).filter(Boolean))].sort()
  };
  _locationsExpiry = Date.now() + 5 * 60 * 1000;
  return _locationsCache;
}

function buildSystemPrompt(locs) {
  return `You are the Property World search assistant. Translate each free-form query into structured filters using the search_listings tool.

Countries in inventory: ${locs.countries.join(', ') || '(none)'}
Cities in inventory: ${locs.cities.join(', ') || '(none)'}
Regions/nodes in inventory: ${locs.regions.join(', ') || '(none)'}

Rules:
1. If the user is searching for a property, ALWAYS call the tool — even if only one token extracts.
2. If the query is a place name (e.g. "phakalane", "gaborone"), match it against the cities/regions above and populate city and/or region. If ambiguous, put it in "q" as free-text AND in "matched".
3. Currency inference: BWP for Botswana, USD for US, EUR for Europe, GBP for UK. If unspecified and location is Botswana, use BWP; otherwise USD.
4. "matched" is human-readable labels for the filter chips shown to the user — e.g. ["Villa","Portugal","Under 5M"]. Never empty.
5. Do not explain, do not ask questions. Extract only.
6. If nothing meaningful extracts, put the raw query in "q" and "matched".`;
}

const TOOLS = [{
  type: 'function',
  function: {
    name: 'search_listings',
    description: 'Apply structured filters to a property search.',
    parameters: {
      type: 'object',
      properties: {
        q:          { type: 'string',  description: 'Free-text term (place, keyword, street, description)' },
        mode:       { type: 'string',  enum: ['buy','rent'] },
        category:   { type: 'string',  enum: KNOWN_CATEGORIES },
        types:      { type: 'array',   items: { type: 'string', enum: KNOWN_TYPES } },
        amenities:  { type: 'array',   items: { type: 'string', enum: KNOWN_AMENITIES } },
        country:    { type: 'string' },
        city:       { type: 'string' },
        region:     { type: 'string' },
        priceMin:   { type: 'number' },
        priceMax:   { type: 'number' },
        beds:       { type: 'integer' },
        newBuild:   { type: 'boolean' },
        matched:    { type: 'array', items: { type: 'string' } }
      },
      required: ['matched']
    }
  }
}];

class AiParseService {
  constructor(db) { this.db = db; }

  async parse(query) {
    if (!config.ai.apiKey) return null;

    const locs = await getLocations(this.db);
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(locs) },
          { role: 'user', content: query }
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 300
      })
    });

    if (!res.ok) {
      console.warn('[ai-parse] Groq error:', res.status);
      return null;
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    if (!choice?.message?.tool_calls?.length) return null;

    let args;
    try {
      args = JSON.parse(choice.message.tool_calls[0].function.arguments);
    } catch (err) {
      console.warn('[ai-parse] args parse failed:', err.message);
      return null;
    }

    return this._normalize(args, query);
  }

  _normalize(args, rawQuery) {
    const matched = Array.isArray(args.matched) && args.matched.length
      ? args.matched
      : [rawQuery];

    return {
      q:         args.q || null,
      mode:      args.mode || null,
      category:  args.category || null,
      types:     Array.isArray(args.types) ? args.types : [],
      amenities: Array.isArray(args.amenities) ? args.amenities : [],
      country:   args.country || null,
      city:      args.city || null,
      region:    args.region || null,
      priceMin:  args.priceMin ?? null,
      priceMax:  args.priceMax ?? null,
      beds:      args.beds || null,
      newBuild:  !!args.newBuild,
      matched
    };
  }
}

module.exports = AiParseService;