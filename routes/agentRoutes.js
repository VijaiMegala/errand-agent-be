import { Router } from 'express';
import { createAgentController } from '../controllers/agentController.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';

export function createAgentRouter(agentService, authService) {
  const router = Router();
  const controller = createAgentController(agentService);
  router.use(requireAuth(authService), (req, _res, next) => {
    if (req.auth.role !== 'customer') return next(new HttpError(403, 'Customer access required'));
    next();
  });
  router.post('/chat', controller.chat);
  router.get('/sessions', controller.listSessions);
  router.get('/sessions/:sessionId/messages', controller.listMessages);
  router.patch('/sessions/:sessionId', controller.renameSession);
  router.delete('/sessions/:sessionId', controller.deleteSession);
  return router;
}
