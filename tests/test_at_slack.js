'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_at_slack_chat', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.open', {
    users: 'U1235BAZZ,U1235QUUX',
  }, {
    ok: true,
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', '@slack chat test_slack_bazz test_slack_quux' ] });
  c.end();
  t.end();
});

test('irc_at_slack_chat_err', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':irslackd NOTICE #test_chan_1 :Unknown nickname: test_slack_lusr');
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', '@slack chat test_slack_lusr' ] });
  c.end();
  t.end();
});
