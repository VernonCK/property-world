'use strict';

const express = require('express');
const multer = require('multer');
const ValuationService = require('../services/valuation.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || file.mimetype === 'application/pdf';
    if (!ok) return cb(new Error('Only images and PDFs are accepted'));
    cb(null, true);
  }
});

module.exports = function valuationRoutes({ db }) {
  const router = express.Router();
  const service = new ValuationService(db);

  /**
   * POST /api/vas/valuation
   * Public. Multipart form-data with all form fields plus
   * `proof_of_payment` file. Returns { id, ref, status, pdf_url }.
   */
  router.post('/valuation', (req, res, next) => {
    upload.single('proof_of_payment')(req, res, (err) => {
      if (err) {
        const e = new Error(err.message || 'File upload failed');
        e.status = 422;
        e.code = 'file_upload_error';
        return next(e);
      }
      service.submit(req.body || {}, req.file || null)
        .then(result => res.status(201).json(result))
        .catch(next);
    });
  });

  return router;
};