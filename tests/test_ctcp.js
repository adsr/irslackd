'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_ctcp_action', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.meMessage', {
    channel: 'C1234CHAN1',
    text: 'me',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', '\x01ACTION me\x01' ] });
  c.end();
  t.end();
});

test('slack_me_message', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :\x01ACTION me\x01');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'me',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
    subtype: 'me_message',
  });
  c.end();
  t.end();
});

test('slack_ctcp_typing_disabled', async(t) => {
  t.plan(0 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  await c.daemon.onSlackUserTyping(c.ircUser, {
    type: 'user_typing',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
  });
  c.end();
  t.end();
});

test('slack_ctcp_typing_enabled', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['typing-notifications']);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :\x01TYPING 1\x01');
  await c.daemon.onSlackUserTyping(c.ircUser, {
    type: 'user_typing',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
  });
  c.end();
  t.end();
});
