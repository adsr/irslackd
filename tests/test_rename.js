'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('slack_rename', async(t) => {
  t.plan(6 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.info', { channel: 'C1234CHAN1' }, {
    ok: true,
    channel: {
      id: 'C1234CHAN1',
      topic: {
        value: 'foobar topic here',
      },
    },
  });
  c.slackWeb.expect('conversations.members', { channel: 'C1234CHAN1', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235BARR',
  ]});
  c.ircSocket.expect(':test_slack_user PART #test_chan_1');
  c.ircSocket.expect(':test_slack_user JOIN #test_chan_new');
  c.ircSocket.expect(':irslackd 332 test_slack_user #test_chan_new :foobar topic here');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #test_chan_new :test_slack_user test_slack_user test_slack_barr');
  await c.daemon.onSlackChannelRename(c.ircUser, {
    type: 'channel_rename',
    channel: {
      id: 'C1234CHAN1',
      name: 'test_chan_new',
      created: 1527736458,
    },
  });
  t.end();
});
