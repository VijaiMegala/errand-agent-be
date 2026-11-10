export function createNotificationController(service) {
  return {
    async list(req, res, next) {
      try { res.json({ data: await service.list(req.auth) }); }
      catch (error) { next(error); }
    },
    async markRead(req, res, next) {
      try { res.json({ data: await service.markRead(req.params.notificationId, req.auth) }); }
      catch (error) { next(error); }
    },
  };
}
