'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_whois', async(t) => {
  t.plan(6 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('users.info', { user: 'U1235QUUX' }, {
    ok: true,
    user: {
      name: 'test_slack_quux',
      real_name: 'John Quux',
    },
  });
  c.ircSocket.expect(':irslackd 311 test_slack_user test_slack_quux test_slack_quux irslackd * :John Quux');
  c.ircSocket.expect(':irslackd 319 test_slack_user test_slack_quux :');
  c.ircSocket.expect(':irslackd 312 test_slack_user test_slack_quux api.slack.com :The SLACK API');
  c.ircSocket.expect(':irslackd 301 test_slack_user test_slack_quux :Gone (Away)');
  c.ircSocket.expect(':irslackd 318 test_slack_user test_slack_quux test_slack_quux irslackd test_slack_quux :End of /WHOIS list.');
  await c.daemon.onIrcWhois(c.ircUser, { args: [ 'test_slack_quux' ] });
  t.end();
});
