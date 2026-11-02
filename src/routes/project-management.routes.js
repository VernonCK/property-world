'use strict';

const express = require('express');
const ProjectManagementService = require('../services/project-management.service');

module.exports = function projectManagementRoutes({ db }) {
  const router = express.Router();
  const service = new ProjectManagementService(db);

  /**
   * POST /api/vas/project-management
   * Public. Accepts the project enquiry as JSON.
   * Returns { id, ref, status }.
   */
  router.post('/project-management', async (req, res, next) => {
    try {
      const result = await service.submit(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};