'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('slack_presence_change_noop', async(t) => {
  t.plan(0 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  await c.daemon.onSlackPresenceChange(c.ircUser, {
    type: 'presence_change',
    presence: 'away',
    user: 'U1234USER',
  });
  await c.daemon.onSlackPresenceChange(c.ircUser, {
    type: 'presence_change',
    presence: 'active',
    user: 'U1234USER',
  });
  t.end();
});

test('slack_presence_change_away', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['presence']);
  c.ircSocket.expect(':irslackd MODE #test_chan_1 -v test_slack_user');
  await c.daemon.onSlackPresenceChange(c.ircUser, {
    type: 'presence_change',
    presence: 'away',
    user: 'U1234USER',
  });
  t.end();
});

test('slack_presence_change_active', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['presence']);
  c.ircSocket.expect(':irslackd MODE #test_chan_1 +v test_slack_user');
  await c.daemon.onSlackPresenceChange(c.ircUser, {
    type: 'presence_change',
    presence: 'active',
    user: 'U1234USER',
  });
  t.end();
});
