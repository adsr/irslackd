'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_privmsg', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello world',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello world' ] });
  console.log('Expect no-op from onSlackMessage (preventSelfEcho)');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  t.end();
});

test('slack_privmsg', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello world',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello world');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  t.end();
});

test('slack_privmsg_hidden', async(t) => {
  t.plan(0 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    hidden: true,
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  t.end();
});
