'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_kick', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircUser.mapIrcToSlack('fun_user', 'U1234USER');
  c.ircUser.mapIrcToSlack('#fun_channel', 'C1234CHAN1');
  var nickMap = new Map();
  nickMap.set('fun_user', true);
  c.ircUser.channelNicks.set('#fun_channel', nickMap);
  c.slackWeb.expect('conversations.kick',
    { channel: 'C1234CHAN1',
      user: 'U1234USER' },
    { ok: true });
  // :WiZ!jto@tolsun.oulu.fi KICK #Finnish John
  c.ircSocket.expect(':test_slack_user KICK #fun_channel fun_user');
  await c.daemon.onIrcKick(c.ircUser, { args: ['#fun_channel', 'fun_user'] });
  t.end();
});
