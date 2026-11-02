'use strict';

const express = require('express');
const ListingService = require('../services/listings.service');

module.exports = function listingRoutes({ db }) {
  const router = express.Router();
  const service = new ListingService(db);

  const parseId = (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid listing id', code: 'bad_request' });
      return null;
    }
    return id;
  };

  /* --- Search / filter / paginate --- */
  router.get('/', async (req, res, next) => {
    try {
      const result = await service.search(req.query);
      res.set('Cache-Control', 'public, max-age=60');
      res.json(result);
    } catch (err) { next(err); }
  });

  /* --- Detail --- */
  router.get('/:id', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const listing = await service.getById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found', code: 'not_found' });
      res.set('Cache-Control', 'public, max-age=60');
      res.json(listing);
    } catch (err) { next(err); }
  });

  /* --- Active offers --- */
  router.get('/:id/offers', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const offers = await service.getOffers(id);
      res.set('Cache-Control', 'no-store');
      res.json(offers);
    } catch (err) { next(err); }
  });

  /* --- Submit competing offer --- */
  router.post('/:id/offers', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const result = await service.createOffer(id, req.body || {});
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  /* --- Recommendations --- */
  router.get('/:id/recommendations', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const limit = Math.min(12, Math.max(1, parseInt(req.query.limit, 10) || 4));
      const items = await service.getRecommendations(id, limit);
      res.set('Cache-Control', 'public, max-age=120');
      res.json({ listings: items });
    } catch (err) { next(err); }
  });

  /* --- Book a viewing (creates VAS request) --- */
  router.post('/:id/viewings', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const result = await service.createViewing(id, req.body || {});
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  /* --- Contact agent (creates VAS brokerage inquiry) --- */
  router.post('/:id/inquiries', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const result = await service.createInquiry(id, req.body || {});
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  /* --- Subscribe to offer/price notifications --- */
  router.post('/:id/subscriptions', async (req, res, next) => {
    try {
      const id = parseId(req, res); if (id == null) return;
      const result = await service.createSubscription(id, req.body || {});
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  return router;
};