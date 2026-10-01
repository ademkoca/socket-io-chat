const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const DEFAULT_ORIGINS = [
  'https://glasklar.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const roomFor = (userId) => `user:${userId}`;

const createSocketServer = ({ port, secret, origins = DEFAULT_ORIGINS }) => {
  if (!secret) throw new Error('SOCKET_SECRET is not set');
  const io = new Server(port, { cors: { origin: origins } });

  // number of open sockets per user, so several tabs count as one online user
  const connections = new Map();
  const broadcastOnlineUsers = () =>
    io.emit(
      'get-users',
      [...connections.keys()].map((userId) => ({ userId }))
    );

  // only connections with a token issued by the API (GET /api/auth/socket-token)
  io.use((socket, next) => {
    try {
      const { userId } = jwt.verify(socket.handshake.auth?.token, secret);
      socket.data.userId = userId;
      next();
    } catch (error) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.join(roomFor(userId));
    connections.set(userId, (connections.get(userId) ?? 0) + 1);
    broadcastOnlineUsers();

    // older clients announce themselves; the identity comes from the token anyway
    socket.on('new-user-add', broadcastOnlineUsers);

    socket.on('disconnect', () => {
      const remaining = (connections.get(userId) ?? 1) - 1;
      if (remaining > 0) connections.set(userId, remaining);
      else connections.delete(userId);
      broadcastOnlineUsers();
    });

    // relay a saved message to every socket of the receiver; the sender is always the token's user
    socket.on('send-message', (data) => {
      if (!data || typeof data.receiverId !== 'string') return;
      socket
        .to(roomFor(data.receiverId))
        .emit('recieve-message', { ...data, senderId: userId });
    });

    socket.on('is-typing', (data) => {
      if (!data || typeof data.receiverId !== 'string') return;
      socket
        .to(roomFor(data.receiverId))
        .emit('receive-is-typing', { senderId: userId, isTyping: data.isTyping === true });
    });
  });

  return io;
};

module.exports = { createSocketServer };
