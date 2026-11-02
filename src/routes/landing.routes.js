'use strict';

const express = require('express');
const LandingService = require('../services/landing.service');

/**
 * Factory — the db instance is injected so this router is stateless.
 * Mounted in server.js at /api.
 */
module.exports = function landingRoutes({ db }) {
  const router = express.Router();
  const service = new LandingService(db);

  /**
   * GET /api
   * Returns the entire landing-page payload in one call.
   * Cached 5 minutes — content changes at most when listings are edited.
   */
  router.get('/', async (_req, res, next) => {
    try {
      const content = await service.getContent();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(content);
    } catch (err) {
      next(err);
    }
  });

  return router;
};