'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_invite', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.invite', {
    users: 'U1235QUUX',
    channel: 'C1234CHAN1',
  }, {
    ok: true,
  });

  c.ircSocket.expect(':irslackd 341 test_slack_user test_slack_quux #test_chan_1');
  await c.daemon.onIrcInvite(c.ircUser, { args: ['test_slack_quux', '#test_chan_1'] });
  t.end();
});
