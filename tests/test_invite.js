'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_invite', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.invite', { users: 'U1235BARR',
    channel: 'CFOOBAR'}, {
    ok: true,
    channel: [
      { id: 'CFOOBAR' },
    ],
  });
  c.ircSocket.expect(':irslackd 341 jay has invited U1235BARR to CFOOBAR');
  await c.daemon.onIrcInvite(c.ircUser, { args: ['U1235BARR', 'CFOOBAR'] });
  t.end();
});
