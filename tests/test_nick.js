'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_nick', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':irslackd 484 test_slack_user :Your connection is restricted!');
  await c.daemon.onIrcNick(c.ircUser, { args: [ 'other_nick' ] });
  c.end();
  t.end();
});
