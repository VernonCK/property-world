'use strict';

const express = require('express');
const AiService = require('../services/ai.service');

module.exports = function aiRoutes({ db }) {
  const router = express.Router();
  const service = new AiService(db);

  /**
   * POST /api/ai/conversations
   * Public (session optional). Idempotent on client_id.
   */
  router.post('/conversations', async (req, res, next) => {
    try {
      const userId = req.user?.id || null;
      const result = await service.saveConversation({ ...req.body, user_id: userId });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/ai/conversations
   * Returns the current user's conversations. Anonymous → [].
   * Optional ?page=landing&limit=20
   */
  router.get('/conversations', async (req, res, next) => {
    try {
      const userId = req.user?.id || null;
      const page = typeof req.query.page === 'string' ? req.query.page : null;
      const limit = parseInt(req.query.limit, 10) || 20;
      const conversations = await service.listConversations({ user_id: userId, page, limit });
      res.json({ conversations });
    } catch (err) {
      next(err);
    }
  });

  return router;
};