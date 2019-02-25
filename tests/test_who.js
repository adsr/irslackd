'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_who', async(t) => {
  t.plan(4 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('users.info', { user: 'U1234USER' }, {
    ok: true,
    user: {
      name: 'fun_user',
      id: 'U1234USER',
      profile: [
        {email: 'foo@example.com',
          real_name: 'Foo Bar' },
      ],
    },
  });
  c.slackWeb.expect('users.list', {
    presence: false,
    limit: 1000}, {
    ok: true,
    members: [
      { name: 'fun_user',
        id: 'U1234USER',
        profile: [
          {email: 'foo@example.com',
            real_name: 'Foo Bar' },
        ]},
    ],
  });
  c.ircSocket.expect(':irslackd 352 test_slack_user # U1234USER irslackd api.slack.com fun_user G :0 Nobody');
  c.ircSocket.expect(':irslackd 315 test_slack_user fun_user :End of WHO list');
  await c.ircUser.mapIrcToSlack('fun_user', 'U1234USER');
  await c.daemon.onIrcWho(c.ircUser, { args: ['fun_user'] });
  t.end();
});
