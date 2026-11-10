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
    async reschedule(req, res, next) {
      try { res.json({ data: await service.reschedule(req.params.bookingId, req.auth, req.body) }); }
      catch (error) { next(error); }
    },
    async listProvider(req, res, next) {
      try { res.json({ data: await service.listProvider(req.params.providerId, req.auth) }); }
      catch (error) { next(error); }
    },
    async listRescheduleRequests(req, res, next) {
      try { res.json({ data: await service.listRescheduleRequests(req.params.providerId, req.auth) }); }
      catch (error) { next(error); }
    },
    async acceptRescheduleRequest(req, res, next) {
      try { res.json({ data: await service.decideRescheduleRequest(req.params.providerId, req.params.requestId, 'accepted', req.auth) }); }
      catch (error) { next(error); }
    },
    async rejectRescheduleRequest(req, res, next) {
      try { res.json({ data: await service.decideRescheduleRequest(req.params.providerId, req.params.requestId, 'rejected', req.auth) }); }
      catch (error) { next(error); }
    },
    async accept(req, res, next) {
      try { res.json({ data: await service.decide(req.params.providerId, req.params.bookingId, 'confirmed', req.auth) }); }
      catch (error) { next(error); }
    },
    async reject(req, res, next) {
      try { res.json({ data: await service.decide(req.params.providerId, req.params.bookingId, 'rejected', req.auth) }); }
      catch (error) { next(error); }
    },
  };
}
