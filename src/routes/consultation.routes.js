'use strict';

const express = require('express');
const ConsultationService = require('../services/consultation.service');

module.exports = function consultationRoutes({ db }) {
  const router = express.Router();
  const service = new ConsultationService(db);

  /**
   * POST /api/vas/investment-consultancy
   * Public. Accepts the enquiry as JSON.
   * Returns { id, ref, status }.
   */
  router.post('/investment-consultancy', async (req, res, next) => {
    try {
      const result = await service.submit(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};