import { pool } from '../models/db.js';
import { createNotificationRepository } from '../models/notificationModel.js';
import { HttpError } from '../utils/httpError.js';

export function createNotificationService(repository) {
  return {
    async list(actor) { return repository.list(actor.id); },
    async markRead(id, actor) {
      if (!/^[1-9]\d*$/.test(id)) throw new HttpError(400, 'notificationId must be a positive integer');
      const record = await repository.markRead(id, actor.id);
      if (!record) throw new HttpError(404, 'Notification not found');
      return record;
    },
  };
}

export const notificationService = createNotificationService(createNotificationRepository(pool));
