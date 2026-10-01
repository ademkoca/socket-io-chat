const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');
const { createSocketServer } = require('../server');

const SECRET = 'test-secret';
const PORT = 8899;
const URL = `http://localhost:${PORT}`;
let server;
const clients = [];

before(() => {
  server = createSocketServer({ port: PORT, secret: SECRET });
});
after(() => {
  clients.forEach((c) => c.close());
  server.close();
});

const tokenFor = (userId, secret = SECRET) => jwt.sign({ userId }, secret, { expiresIn: '1h' });

const open = (auth) =>
  new Promise((resolve, reject) => {
    const client = connect(URL, { auth, reconnection: false, forceNew: true });
    clients.push(client);
    client.on('connect', () => resolve(client));
    client.on('connect_error', reject);
  });

const nextEvent = (client, event, timeout = 1000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeout);
    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const noEvent = (client, event, wait = 300) =>
  new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${event}`));
    client.once(event, handler);
    setTimeout(() => {
      client.off(event, handler);
      resolve();
    }, wait);
  });

test('rejects connections without a valid token', async () => {
  await assert.rejects(open({}), /Unauthorized/);
  await assert.rejects(open({ token: 'garbage' }), /Unauthorized/);
  await assert.rejects(open({ token: tokenFor('alice', 'wrong-secret') }), /Unauthorized/);
});

test('delivers messages to every socket of the receiver with the real sender', async () => {
  const alice = await open({ token: tokenFor('alice') });
  const bobTab1 = await open({ token: tokenFor('bob') });
  const bobTab2 = await open({ token: tokenFor('bob') });
  const received = Promise.all([nextEvent(bobTab1, 'recieve-message'), nextEvent(bobTab2, 'recieve-message')]);
  alice.emit('send-message', { receiverId: 'bob', chatId: 'c1', text: 'hi', senderId: 'mallory' });
  for (const data of await received) {
    assert.equal(data.text, 'hi');
    assert.equal(data.senderId, 'alice');
  }
});

test('a third user cannot receive messages meant for someone else', async () => {
  const alice = await open({ token: tokenFor('alice') });
  const eve = await open({ token: tokenFor('eve') });
  eve.emit('new-user-add', 'bob'); // trying to claim bob's identity
  const silent = noEvent(eve, 'recieve-message');
  alice.emit('send-message', { receiverId: 'bob', chatId: 'c1', text: 'secret' });
  await silent;
});

test('typing indicator carries the sender and only reaches the receiver', async () => {
  const alice = await open({ token: tokenFor('alice') });
  const bob = await open({ token: tokenFor('bob') });
  const typing = nextEvent(bob, 'receive-is-typing');
  alice.emit('is-typing', { receiverId: 'bob', isTyping: true });
  assert.deepEqual(await typing, { senderId: 'alice', isTyping: true });
});

test('online list contains user ids only and drops users after their last tab closes', async () => {
  const carol1 = await open({ token: tokenFor('carol') });
  const watcher = await open({ token: tokenFor('watcher') });
  const carol2 = await open({ token: tokenFor('carol') });
  const listed = (users) => users.some((u) => u.userId === 'carol');
  // a broadcast from an earlier connect can still be in flight, so wait for the expected list
  const usersMatching = (predicate) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('expected list never arrived')), 1000);
      const handler = (users) => {
        if (!predicate(users)) return;
        clearTimeout(timer);
        watcher.off('get-users', handler);
        resolve(users);
      };
      watcher.on('get-users', handler);
    });

  const stillOnline = usersMatching(listed);
  carol1.close();
  const afterFirstClose = await stillOnline;
  assert.ok(afterFirstClose.every((u) => Object.keys(u).join() === 'userId'));

  const gone = usersMatching((users) => !listed(users));
  carol2.close();
  await gone;
});
