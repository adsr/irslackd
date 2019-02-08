'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_invite', async(t) => {
  t.plan(mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('channel.invite', { users: 'U1234USER',
    channel: 'CFOOBAR'}, {
    ok: true,
    channel: [
      { id: 'CFOOBAR' },
    ],
  });
  c.ircSocket.expect('jay has invited U1234USER to CFOOBAR');
  await c.daemon.onIrcInvite(c.ircUser, { args: ['U1234USER', 'CFOOBAR'] });
  t.end();
});
