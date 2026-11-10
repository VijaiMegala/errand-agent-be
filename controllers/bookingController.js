export function createBookingController(service) {
  return {
    async create(req, res, next) {
      try {
        const record = await service.create(req.params.providerId, req.auth, req.body);
        res.status(201).json({ data: record });
      } catch (error) { next(error); }
    },
    async listMine(req, res, next) {
      try { res.json({ data: await service.listMine(req.auth) }); }
      catch (error) { next(error); }
    },
  };
}
