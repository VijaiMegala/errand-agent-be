export function createUserController(service) {
  return {
    async list(req, res, next) {
      try { res.json({ data: await service.list(req.query) }); }
      catch (error) { next(error); }
    },
    async create(req, res, next) {
      try {
        const user = await service.create(req.body);
        res.status(201).location(`/api/users/${user.id}`).json({ data: user });
      } catch (error) { next(error); }
    },
    async get(req, res, next) {
      try { res.json({ data: await service.get(req.params.id) }); }
      catch (error) { next(error); }
    },
    async update(req, res, next) {
      try { res.json({ data: await service.update(req.params.id, req.body) }); }
      catch (error) { next(error); }
    },
    async delete(req, res, next) {
      try {
        await service.delete(req.params.id);
        res.status(204).end();
      } catch (error) { next(error); }
    },
  };
}
