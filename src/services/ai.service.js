'use strict';

const MAX_MESSAGES = 200;
const MAX_TITLE = 120;
const MAX_TEXT = 8000;

class AiService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Upsert by client_id.
   * payload: { client_id, user_id?, page?, title?, messages: [{role,text,ts}] }
   * Returns { id }.
   */
  async saveConversation(payload) {
    const { client_id, user_id, page, title, messages } = payload || {};

    if (!client_id || typeof client_id !== 'string' || client_id.length > 64) {
      throw this._err(422, 'client_id is required (string, max 64 chars)', 'validation_error');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw this._err(422, 'messages must be a non-empty array', 'validation_error');
    }
    if (messages.length > MAX_MESSAGES) {
      throw this._err(422, `messages exceeds max of ${MAX_MESSAGES}`, 'validation_error');
    }

    const cleanMessages = messages.slice(-MAX_MESSAGES).map((m) => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: String(m.text ?? '').slice(0, MAX_TEXT),
      ts: Number(m.ts) || Date.now()
    }));

    let finalTitle = (title || '').trim().slice(0, MAX_TITLE);
    if (!finalTitle) {
      const firstUser = cleanMessages.find((m) => m.role === 'user');
      finalTitle = firstUser ? firstUser.text.slice(0, MAX_TITLE) : 'New chat';
    }

    const existing = await this.db.fetchOne('ai_conversations', { client_id });

    if (existing) {
      await this.db.update(
        'ai_conversations',
        {
          user_id: user_id ?? existing.user_id,
          page: page ?? existing.page,
          title: finalTitle,
          messages: JSON.stringify(cleanMessages)
        },
        { id: existing.id }
      );
      return { id: existing.id };
    }

    const { insertId } = await this.db.insert('ai_conversations', {
      client_id,
      user_id: user_id ?? null,
      page: page ?? null,
      title: finalTitle,
      messages: JSON.stringify(cleanMessages)
    });
    return { id: insertId };
  }

  /**
   * List for a logged-in user. Returns [] for anonymous.
   */
  async listConversations({ user_id, page, limit = 20 } = {}) {
    if (!user_id) return [];

    const where = [{ column: 'user_id', op: '=', value: user_id }];
    if (page) where.push({ column: 'page', op: '=', value: page });

    const rows = await this.db.fetchAll('ai_conversations', {
      where,
      orderBy: { column: 'updated_at', direction: 'DESC' },
      limit: Math.min(50, Math.max(1, limit)),
      columns: ['id', 'client_id', 'page', 'title', 'messages', 'created_at', 'updated_at']
    });

    return rows.map((r) => ({ ...r, messages: this._parseMessages(r.messages) }));
  }

  _parseMessages(raw) {
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _err(status, message, code) {
    const e = new Error(message);
    e.status = status;
    e.code = code;
    return e;
  }
}

module.exports = AiService;