import { HttpError } from '../utils/httpError.js';

export function requireAuth(authService) {
  return async (req, _res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
      if (!match) throw new HttpError(401, 'Bearer access token required');
      req.auth = await authService.authenticate(match[1]);
      next();
    } catch (error) { next(error); }
  };
}

export function requireSelf(req, _res, next) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return next(new HttpError(400, 'id must be a UUID'));
  }
  if (req.auth.id.toLowerCase() !== req.params.id.toLowerCase()) {
    return next(new HttpError(403, 'You can access only your own account'));
  }
  next();
}
