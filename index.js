const { createSocketServer } = require('./server');

const port = process.env.PORT || 8800;

createSocketServer({
  port,
  secret: process.env.SOCKET_SECRET,
  origins: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()),
});
console.log(`Socket server listening at port ${port}`);
