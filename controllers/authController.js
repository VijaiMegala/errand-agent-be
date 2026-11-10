export function createAuthController(service) {
  return {
    async login(req, res, next) {
      try { res.json(await service.login(req.body)); }
      catch (error) { next(error); }
    },
    introspect(req, res) {
      res.set('Cache-Control', 'no-store');
      res.json({ active: true, userId: req.auth.id, role: req.auth.role });
    },
    async changePassword(req, res, next) {
      try { res.json(await service.changePassword(req.params.id, req.body)); }
      catch (error) { next(error); }
    },
  };
}
