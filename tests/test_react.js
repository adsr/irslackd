'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('slack_react', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :' + String.fromCharCode(1) + 'ACTION reacts @ test_slack_barr :sunglasses:' + String.fromCharCode(1));
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
  c.end();
  t.end();
});
