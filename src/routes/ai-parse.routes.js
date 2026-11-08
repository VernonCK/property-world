'use strict';

const express = require('express');
const AiParseService = require('../services/ai-parse.service');

module.exports = function aiParseRoutes({ db }) {
  const router = express.Router();
  const service = new AiParseService(db);

  router.post('/parse', async (req, res, next) => {
    try {
      const query = String(req.body?.query || '').trim();
      if (!query) return res.status(400).json({ error: 'query required', code: 'validation_error' });

      const parsed = await service.parse(query);
      res.json({ parsed: parsed || null });
    } catch (err) { next(err); }
  });

  return router;
};