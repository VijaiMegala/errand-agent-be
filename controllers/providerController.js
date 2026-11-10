export function createProviderController(service) {
  return {
    async createService(req, res, next) {
      try {
        const record = await service.createService(req.params.providerId, req.auth, req.body);
        res.status(201).json({ data: record });
      } catch (error) { next(error); }
    },
    async listServices(req, res, next) {
      try { res.json({ data: await service.listServices(req.params.providerId) }); }
      catch (error) { next(error); }
    },
    async createSlot(req, res, next) {
      try {
        const record = await service.createSlot(req.params.providerId, req.auth, req.body);
        res.status(201).json({ data: record });
      } catch (error) { next(error); }
    },
    async listSlots(req, res, next) {
      try { res.json({ data: await service.listSlots(req.params.providerId) }); }
      catch (error) { next(error); }
    },
    async createReview(req, res, next) {
      try {
        const record = await service.createReview(req.params.providerId, req.auth, req.body);
        res.status(201).json({ data: record });
      } catch (error) { next(error); }
    },
    async listReviews(req, res, next) {
      try { res.json({ data: await service.listReviews(req.params.providerId) }); }
      catch (error) { next(error); }
    },
  };
}
