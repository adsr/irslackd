'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('pref_no-reactions', async(t) => {
  t.plan(0 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['no-reactions']);
  await c.daemon.onSlackReactionAdded(c.ircUser, {
    type: 'reaction_added',
    user: 'U1234USER',
    reaction: 'sunglasses',
    item_user: 'U1235BARR',
    item: {
      type: 'message',
      channel: 'C1234CHAN1',
      ts: '1360782400.498405',
    },
    event_ts: '1360782804.083113',
  });
  t.end();
});

test('pref_no-threads', async(t) => {
  t.plan(0 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['no-threads']);
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
    thread_ts: '12345678.901234',
  });
  t.end();
});
