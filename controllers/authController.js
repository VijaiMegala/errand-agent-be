export function createAuthController(service) {
  return {
    async login(req, res, next) {
      try { res.json(await service.login(req.body)); }
      catch (error) { next(error); }
    },
    async changePassword(req, res, next) {
      try { res.json(await service.changePassword(req.params.id, req.body)); }
      catch (error) { next(error); }
    },
  };
}
