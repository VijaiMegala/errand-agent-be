import IORedis from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';

export const notificationChannel = 'booking-notifications:live';

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachNotificationSocket(server, { authService, redisUrl, corsOrigin = null, subscriber = null }) {
  if (!subscriber && !redisUrl) throw new Error('REDIS_URL is required for notification WebSockets');
  const redis = subscriber ?? new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const ownsRedis = !subscriber;
  const sockets = new Map();
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => protocols.has('bearer') ? 'bearer' : false });
  let ready = false;
  let closed = false;

  const subscribe = async () => {
    try {
      await redis.subscribe(notificationChannel);
      ready = true;
    } catch (error) {
      ready = false;
      console.error('Notification subscription failed:', error.message);
    }
  };
  redis.on('ready', subscribe);
  redis.on('close', () => { ready = false; });
  redis.on('error', (error) => console.error('Notification subscription error:', error.message));
  redis.on('message', (channel, message) => {
    if (channel !== notificationChannel) return;
    let event;
    try { event = JSON.parse(message); }
    catch { return; }
    if (typeof event?.recipientUserId !== 'string' || !event.notification) return;
    const payload = JSON.stringify({ type: 'notification', data: event.notification });
    for (const socket of sockets.get(event.recipientUserId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  });
  if (redis.status === 'ready') void subscribe();

  const upgrade = async (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/notifications/ws') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!ready) { rejectUpgrade(socket, 503, 'Service Unavailable'); return; }
    if (corsOrigin && request.headers.origin && request.headers.origin !== corsOrigin) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const protocols = (request.headers['sec-websocket-protocol'] ?? '').split(',').map((value) => value.trim());
    if (protocols.length !== 2 || protocols[0] !== 'bearer' || !protocols[1]) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    let actor;
    try { actor = await authService.authenticate(protocols[1]); }
    catch { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
    if (socket.destroyed || closed) return;
    wss.handleUpgrade(request, socket, head, (connection) => {
      connection.authToken = protocols[1];
      const userSockets = sockets.get(actor.id) ?? new Set();
      userSockets.add(connection);
      sockets.set(actor.id, userSockets);
      connection.on('close', () => {
        userSockets.delete(connection);
        if (!userSockets.size) sockets.delete(actor.id);
      });
      connection.send(JSON.stringify({ type: 'ready' }));
    });
  };
  server.on('upgrade', upgrade);

  const heartbeat = setInterval(async () => {
    for (const [userId, userSockets] of sockets) {
      for (const socket of userSockets) {
        try {
          const actor = await authService.authenticate(socket.authToken);
          if (actor.id !== userId) throw new Error('Account changed');
          if (socket.readyState === WebSocket.OPEN) socket.ping();
        } catch { socket.close(4001, 'Authentication expired'); }
      }
    }
  }, 30000);
  heartbeat.unref();

  return async () => {
    closed = true;
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
    for (const userSockets of sockets.values()) for (const socket of userSockets) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (ownsRedis) redis.disconnect();
  };
}
