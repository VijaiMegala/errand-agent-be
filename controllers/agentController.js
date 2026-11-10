import { once } from 'node:events';
import { HttpError } from '../utils/httpError.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedBodyKeys = new Set(['sessionId', 'message', 'approval']);

function parseChatBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowedBodyKeys.has(key))) {
    throw new HttpError(400, 'Invalid chat request');
  }

  const sessionId = body.sessionId;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !uuidPattern.test(sessionId))) {
    throw new HttpError(400, 'sessionId must be a UUID');
  }

  const hasMessage = Object.hasOwn(body, 'message');
  const hasApproval = Object.hasOwn(body, 'approval');
  if (hasMessage === hasApproval) {
    throw new HttpError(400, 'Provide either message or approval');
  }

  if (hasMessage) {
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 8000) {
      throw new HttpError(400, 'message must be 1 to 8000 characters');
    }
    return { sessionId, message: body.message.trim() };
  }

  const approval = body.approval;
  if (!sessionId || !approval || typeof approval !== 'object' || Array.isArray(approval) ||
      Object.keys(approval).some((key) => !['id', 'confirm'].includes(key)) ||
      typeof approval.id !== 'string' || !uuidPattern.test(approval.id) || approval.confirm !== true) {
    throw new HttpError(400, 'approval requires a sessionId, UUID id, and confirm: true');
  }
  return { sessionId, approval: { id: approval.id, confirm: true } };
}

export function createAgentController(agentService) {
  return {
    async listSessions(req, res, next) {
      try { res.json({ data: await agentService.listSessions(req.auth, req.query) }); }
      catch (error) { next(error); }
    },
    async listMessages(req, res, next) {
      try { res.json({ data: await agentService.listMessages(req.auth, req.params.sessionId, req.query) }); }
      catch (error) { next(error); }
    },
    async renameSession(req, res, next) {
      try { res.json({ data: await agentService.renameSession(req.auth, req.params.sessionId, req.body) }); }
      catch (error) { next(error); }
    },
    async deleteSession(req, res, next) {
      try { await agentService.deleteSession(req.auth, req.params.sessionId); res.status(204).end(); }
      catch (error) { next(error); }
    },
    async chat(req, res, next) {
      let input;
      try { input = parseChatBody(req.body); }
      catch (error) { return next(error); }

      const accessToken = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const abortController = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) abortController.abort();
      };
      res.once('close', onClose);

      const startStream = () => {
        if (res.headersSent) return;
        res.status(200).set({
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
      };

      const emit = async (event) => {
        if (abortController.signal.aborted || res.destroyed) throw new Error('Client disconnected');
        startStream();
        if (!res.write(`${JSON.stringify(event)}\n`)) {
          await once(res, 'drain', { signal: abortController.signal });
        }
      };

      try {
        const result = await agentService.chat({
          user: req.auth,
          accessToken,
          ...input,
        }, emit, abortController.signal);
        if (abortController.signal.aborted || res.destroyed) return;
        await emit({ type: 'done', ...result });
        res.end();
      } catch (error) {
        if (abortController.signal.aborted || res.destroyed) return;
        if (!res.headersSent) return next(error);
        try {
          await emit({
            type: 'error',
            error: error instanceof HttpError ? error.message : 'Agent request failed',
          });
        } catch { /* The client may disconnect while the error is sent. */ }
        res.end();
      } finally {
        res.off('close', onClose);
      }
    },
  };
}
