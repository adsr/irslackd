'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_who', async(t) => {
  t.plan(3 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('users.info', { user: 'U1234USER' }, {
    ok: true,
    user: {
      name: 'test_slack_user',
      id: 'U1234USER',
      profile: [
        {email: 'foo@example.com',
          real_name: 'Foo Bar' },
      ],
    },
  });
  c.ircSocket.expect(':irslackd 352 test_slack_user # U1234USER irslackd api.slack.com test_slack_user G :0 Nobody');
  c.ircSocket.expect(':irslackd 315 test_slack_user test_slack_user :End of WHO list');
  await c.ircUser.mapIrcToSlack('test_slack_user', 'U1234USER');
  await c.daemon.onIrcWho(c.ircUser, { args: ['test_slack_user'] });
  t.end();
});
