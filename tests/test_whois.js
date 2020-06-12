'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_whois', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('users.info', { user: 'U1235QUUX' }, {
    ok: true,
    user: {
      name: 'test_slack_quux',
      real_name: 'John Quux',
    },
  });
  c.ircSocket.expect(':irslackd 311 test_slack_user test_slack_quux test_slack_quux irslackd * :John Quux');
  await c.daemon.onIrcWhois(c.ircUser, { args: [ 'test_slack_quux' ] });
  c.end();
  t.end();
});
