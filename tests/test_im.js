'use strict';

const test = require('tape');
const mocks = require('./mocks');

// Test sending an IM to a target user
test('slack_im_send', async(t) => {
  t.plan(4 + mocks.connectOneIrcClient.planCount);

  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.open', { users: 'U1235FOOO' }, {
    ok: true,
    user: 'U1235FOOO',
    channel: {
      id: 'D1235CHAN1',
    },
  });

  c.slackWeb.expect('chat.postMessage', {
    channel: 'D1235CHAN1',
    text: 'hello world',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'D1235CHAN1',
    ts: '1234.5678',
  });

  c.slackWeb.expect('conversations.info', { channel: 'D1235CHAN1' }, {
    ok: true,
    channel: {
      user: 'U1235FOOO',
      id: 'D1235CHAN1',
      is_im: true,
    },
  });

  // We get this when the message is echoed back to us.
  c.ircSocket.expect(':test_slack_fooo PRIVMSG test_slack_user :hello world');

  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ 'test_slack_fooo', 'hello world' ] });

  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1235FOOO',
    channel: 'D1235CHAN1',
  });

  c.end();
  t.end();
});

// Receiving an IM from another user that's not us
test('slack_im_receive', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);

  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.info', { channel: 'D1235CHAN1' }, {
    ok: true,
    channel: {
      user: 'U1235FOOO',
      id: 'D1235CHAN1',
      is_im: true,
    },
  });

  // We get this when the message is echoed back to us.
  c.ircSocket.expect(':test_slack_fooo PRIVMSG test_slack_user :hello world');

  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1235FOOO',
    channel: 'D1235CHAN1',
  });

  c.end();
  t.end();
});

// Receiving an IM from ourselves (e.g. sent from a different client)
test('slack_im_receive_from_self', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);

  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.info', { channel: 'D1235CHAN1' }, {
    ok: true,
    channel: {
      user: 'U1235FOOO',
      id: 'D1235CHAN1',
      is_im: true,
    },
  });

  // We get this when the message is echoed back to us.
  c.ircSocket.expect(':test_slack_user PRIVMSG test_slack_fooo :hello world');

  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'D1235CHAN1',
  });

  c.end();
  t.end();
});
