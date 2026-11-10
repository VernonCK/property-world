'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./src/config');
const { Database } = require('./src/db/database');
const { closeBrowser } = require('./src/services/instruction-pdf.service');
const landingRoutes = require('./src/routes/landing.routes');
const aiRoutes = require('./src/routes/ai.routes');
const listingRoutes = require('./src/routes/listings.routes');
const brokerageRoutes = require('./src/routes/brokerage.routes');
const valuationRoutes = require('./src/routes/valuation.routes');
const consultationRoutes = require('./src/routes/consultation.routes');
const projectManagementRoutes = require('./src/routes/project-management.routes');
const propertyManagementRoutes = require('./src/routes/property-management.routes');
const aiParseRoutes = require('./src/routes/ai-parse.routes');

async function main() {
  /* Fail fast if the DB is unreachable */
  const db = await Database.connect();

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  /* Static assets (css, js, images, html) live in ./public */
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));

  /* Root → landing page */
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'landing.html'));
  });
  
  /* API routes */
  app.use('/api', landingRoutes({ db }));
  app.use('/api/ai', aiRoutes({ db }));
  app.use('/api/ai', aiParseRoutes({ db }));
  app.use('/api/listings', listingRoutes({ db }));
  app.use('/api/vas', brokerageRoutes({ db }));
  app.use('/api/vas', valuationRoutes({ db }));
  app.use('/api/vas', consultationRoutes({ db }));
  app.use('/api/vas', projectManagementRoutes({ db }));
  app.use('/api/vas', propertyManagementRoutes({ db }));

  /* Health check */
  app.get('/healthz', async (_req, res) => {
     /*const mysql = require('mysql2/promise');

      const connection = await mysql.createConnection({
        host: 'sql.freedb.tech', // Replace with your TiDB host
        port: 3306,
        user: 'u_49l1J9', // Replace with your exact prefixed username
        password: 'CRE5uxRtuVYg',
        database: 'freedb_iWowESWu'
      });

      const [rows] = await connection.execute('SELECT 1 AS connected');
      console.log(rows); // Outputs: [ { connected: 1 } ]
      await connection.end();*/
      res.json({ ok: true, app: 'front' })
  });

  /* 404 for unknown API paths */
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', code: 'not_found', path: req.path });
  });

  /* Central error handler */
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[front]', err);
    res.status(status).json({ error: err.message || 'Internal error', code: err.code || 'internal_error' });
  });

  app.listen(config.front.port, () => {
    console.log(`[Property World] listening on http://localhost:${config.front.port}`);
    setInterval(async () => {
      try {
        await fetch("https://property-world.onrender.com");
        console.log("Self-ping sent PW");
      } catch (err) {
        console.error("Ping failed:", err);
      }
    }, 5 * 60 * 1000); // every 5 minutes
  });

  /* Graceful shutdown */
  const shutdown = async () => { await db.close(); await closeBrowser(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[front] fatal:', err);
  process.exit(1);
});