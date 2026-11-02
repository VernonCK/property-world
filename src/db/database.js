'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

/* ─── Identifier safety ──────────────────────────────────────────────── */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name) {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`);
  }
  return `\`${name}\``;
}

function columnList(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('columnList requires a non-empty array');
  }
  return columns.map(ident).join(', ');
}

/* WHERE builder — accepts either:
     { id: 5, status: 'active' }
   or an array of { column, op, value }:
     [{ column: 'price', op: '>', value: 100 },
      { column: 'status', op: '=',  value: 'live' }]
   Returns { sql: 'WHERE ...', params: [...] } or null. */
const OPS = new Set(['=', '<>', '!=', '<', '<=', '>', '>=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL']);

function buildWhere(where) {
  if (!where) return { sql: '', params: [] };

  const parts = [];
  const params = [];

  const add = (column, op, value) => {
    const c = ident(column);
    const o = String(op || '=').toUpperCase();
    if (!OPS.has(o)) throw new Error(`Unsupported operator: ${op}`);

    if (o === 'IS NULL' || o === 'IS NOT NULL') {
      parts.push(`${c} ${o}`);
      return;
    }
    if (o === 'IN') {
      if (!Array.isArray(value) || value.length === 0) {
        parts.push('0 = 1'); // empty IN → no matches, safely
        return;
      }
      parts.push(`${c} IN (${value.map(() => '?').join(', ')})`);
      params.push(...value);
      return;
    }
    parts.push(`${c} ${o} ?`);
    params.push(value);
  };

  if (Array.isArray(where)) {
    for (const clause of where) {
      if (!clause || typeof clause !== 'object' || !clause.column) {
        throw new Error('Each where clause needs { column, value }');
      }
      add(clause.column, clause.op, clause.value);
    }
  } else if (typeof where === 'object') {
    for (const [column, value] of Object.entries(where)) {
      add(column, '=', value);
    }
  } else {
    throw new Error('where must be an object or an array of clauses');
  }

  if (parts.length === 0) return { sql: '', params: [] };
  return { sql: 'WHERE ' + parts.join(' AND '), params };
}

function buildOrderBy(orderBy) {
  if (!orderBy) return '';
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = items.map((o) => {
    if (typeof o === 'string') return ident(o);
    const dir = String(o.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return `${ident(o.column)} ${dir}`;
  });
  return 'ORDER BY ' + parts.join(', ');
}

/* ─── Database class ────────────────────────────────────────────────── */
class Database {
  constructor(pool) {
    this.pool = pool;
  }

  /** Static factory — opens a shared pool. Call once at boot. */
  static async connect(overrides = {}) {
    const pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.poolSize,
      queueLimit: 0,
      timezone: config.db.timezone,
      dateStrings: false,
      ...overrides,
    });
    /* Fail fast if the DB isn't reachable */
    const conn = await pool.getConnection();
    conn.release();
    return new Database(pool);
  }

  async close() {
    await this.pool.end();
  }

  /** Escape hatch — use sparingly. Always parameterised. */
  async query(sql, params = []) {
    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  /** fetchAll — SELECT with optional filtering, ordering, paging. */
  async fetchAll(table, options = {}) {
    const { where, orderBy, limit, offset, columns } = options;
    const w = buildWhere(where);
    const cols = columns ? columnList(columns) : '*';
    const order = buildOrderBy(orderBy);

    let sql = `SELECT ${cols} FROM ${ident(table)} ${w.sql} ${order}`.trim();
    const params = [...w.params];

    if (typeof limit === 'number' && limit > 0) {
      sql += ' LIMIT ?';
      params.push(limit);
      if (typeof offset === 'number' && offset > 0) {
        sql += ' OFFSET ?';
        params.push(offset);
      }
    }

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  /** fetchOne — returns the first row or null. */
  async fetchOne(table, where, options = {}) {
    const rows = await this.fetchAll(table, { where, limit: 1, ...options });
    return rows[0] || null;
  }

  /** fetchById — convenience for { id: ... }. */
  async fetchById(table, id, idColumn = 'id', options = {}) {
    return this.fetchOne(table, { [idColumn]: id }, options);
  }

  /** count — SELECT COUNT(*) with the same WHERE builder. */
  async count(table, where) {
    const w = buildWhere(where);
    const sql = `SELECT COUNT(*) AS n FROM ${ident(table)} ${w.sql}`;
    const [rows] = await this.pool.execute(sql, w.params);
    return Number(rows[0]?.n || 0);
  }

  /** insert — returns { insertId, affectedRows }. */
  async insert(table, data) {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      throw new Error('insert requires a non-empty data object');
    }
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${ident(table)} (${columnList(cols)}) VALUES (${placeholders})`;
    const [result] = await this.pool.execute(sql, Object.values(data));
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  }

  /** update — data and where are plain objects. */
  async update(table, data, where) {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      throw new Error('update requires a non-empty data object');
    }
    const w = buildWhere(where);
    if (!w.sql) throw new Error('update requires a WHERE clause — refusing to update every row');

    const setClause = Object.keys(data).map((c) => `${ident(c)} = ?`).join(', ');
    const sql = `UPDATE ${ident(table)} SET ${setClause} ${w.sql}`;
    const params = [...Object.values(data), ...w.params];
    const [result] = await this.pool.execute(sql, params);
    return { affectedRows: result.affectedRows };
  }

  /** delete — same guard: WHERE is mandatory. */
  async delete(table, where) {
    const w = buildWhere(where);
    if (!w.sql) throw new Error('delete requires a WHERE clause — refusing to delete every row');
    const sql = `DELETE FROM ${ident(table)} ${w.sql}`;
    const [result] = await this.pool.execute(sql, w.params);
    return { affectedRows: result.affectedRows };
  }

  /**
   * transaction — runs fn(tx) where tx is a wrapper with the same API
   * bound to a single connection. Rolls back on throw.
   */
  async transaction(fn) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = new TransactionalDb(conn);
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw err;
    } finally {
      conn.release();
    }
  }
}

/* Same API surface as Database, bound to a single connection. */
class TransactionalDb {
  constructor(conn) { this.conn = conn; }

  async query(sql, params = []) {
    const [rows] = await this.conn.execute(sql, params);
    return rows;
  }
  async fetchAll(table, options = {}) {
    const { where, orderBy, limit, offset, columns } = options;
    const w = buildWhere(where);
    const cols = columns ? columnList(columns) : '*';
    let sql = `SELECT ${cols} FROM ${ident(table)} ${w.sql} ${buildOrderBy(orderBy)}`.trim();
    const params = [...w.params];
    if (typeof limit === 'number' && limit > 0) {
      sql += ' LIMIT ?'; params.push(limit);
      if (typeof offset === 'number' && offset > 0) { sql += ' OFFSET ?'; params.push(offset); }
    }
    const [rows] = await this.conn.execute(sql, params);
    return rows;
  }
  async fetchOne(table, where, options = {}) {
    const rows = await this.fetchAll(table, { where, limit: 1, ...options });
    return rows[0] || null;
  }
  async fetchById(table, id, idColumn = 'id', options = {}) {
    return this.fetchOne(table, { [idColumn]: id }, options);
  }
  async count(table, where) {
    const w = buildWhere(where);
    const [rows] = await this.conn.execute(`SELECT COUNT(*) AS n FROM ${ident(table)} ${w.sql}`, w.params);
    return Number(rows[0]?.n || 0);
  }
  async insert(table, data) {
    const cols = Object.keys(data);
    const sql = `INSERT INTO ${ident(table)} (${columnList(cols)}) VALUES (${cols.map(() => '?').join(', ')})`;
    const [result] = await this.conn.execute(sql, Object.values(data));
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  }
  async update(table, data, where) {
    const w = buildWhere(where);
    if (!w.sql) throw new Error('update requires a WHERE clause');
    const setClause = Object.keys(data).map((c) => `${ident(c)} = ?`).join(', ');
    const [result] = await this.conn.execute(
      `UPDATE ${ident(table)} SET ${setClause} ${w.sql}`,
      [...Object.values(data), ...w.params]
    );
    return { affectedRows: result.affectedRows };
  }
  async delete(table, where) {
    const w = buildWhere(where);
    if (!w.sql) throw new Error('delete requires a WHERE clause');
    const [result] = await this.conn.execute(`DELETE FROM ${ident(table)} ${w.sql}`, w.params);
    return { affectedRows: result.affectedRows };
  }
}

module.exports = { Database, TransactionalDb };