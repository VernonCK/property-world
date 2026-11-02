'use strict';

const express = require('express');
const PropertyManagementService = require('../services/property-management.service');

module.exports = function propertyManagementRoutes({ db }) {
  const router = express.Router();
  const service = new PropertyManagementService(db);

  /**
   * POST /api/vas/property-management
   * Public. Accepts the quote enquiry as JSON.
   * Returns { id, ref, status }.
   */
  router.post('/property-management', async (req, res, next) => {
    try {
      const result = await service.submit(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};