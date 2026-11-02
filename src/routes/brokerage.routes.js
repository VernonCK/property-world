'use strict';

const express = require('express');
const BrokerageService = require('../services/brokerage.service');

module.exports = function brokerageRoutes({ db }) {
  const router = express.Router();
  const service = new BrokerageService(db);

  /**
   * POST /api/vas/brokerage
   * Public. Accepts the signed instruction as JSON.
   * Returns { id, ref, status, pdf_url } — client redirects the user to pdf_url.
   */
  router.post('/brokerage', async (req, res, next) => {
    try {
      const result = await service.submit(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};