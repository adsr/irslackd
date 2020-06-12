'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_kick', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.kick', {
    channel: 'C1234CHAN1',
    user: 'U1235FOOO',
  }, {
    ok: true,
  });
  c.ircSocket.expect(':test_slack_user KICK #test_chan_1 test_slack_fooo');
  await c.daemon.onIrcKick(c.ircUser, { args: ['#test_chan_1', 'test_slack_fooo'] });
  c.end();
  t.end();
});
