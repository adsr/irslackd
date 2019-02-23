'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_kick', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircUser.mapIrcToSlack('fun_user', 'U1234USER');
  c.ircUser.mapIrcToSlack('#fun_channel', 'C1234CHAN1');
  c.ircUser.channelNicks.put('#fun_channel', ['fun_user']);
  c.slackWeb.expect('conversations.kick', { user: 'U1234USER',
    channel: 'C1234CHAN1'}, {
    ok: true,
  });
  // :WiZ!jto@tolsun.oulu.fi KICK #Finnish John
  c.ircSocket.expect(':irslackd 341 test_slack_user U1234USER C1234CHAN1');
  await c.daemon.onIrcKick(c.ircUser, { args: ['fun_user', '#fun_channel'] });
  t.end();
});
