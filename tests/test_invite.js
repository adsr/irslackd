'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_invite', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircUser.mapIrcToSlack('fun_user', 'U1234USER');
  c.ircUser.mapIrcToSlack('#fun_channel', 'C1234CHAN1');
  console.log('irctoslack:');
  for (var i = 0, keys = Object.keys(c.ircUser.ircToSlack), ii = keys.length; i < ii; i++) {
    console.log(keys[i] + '|' + c.ircUser.ircToSlack[keys[i]].list);
  }
  c.slackWeb.expect('conversations.invite', { users: 'U1234USER',
    channel: 'C1234CHAN1'}, {
    ok: true,
    channel: [
      { id: 'C1234CHAN1' },
    ],
  });
  c.ircSocket.expect(':irslackd 341 test_slack_user U1234USER C1234CHAN1');
  await c.daemon.onIrcInvite(c.ircUser, { args: ['fun_user', '#fun_channel'] });
  t.end();
});
