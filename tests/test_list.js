'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_list', async(t) => {
  t.plan(5 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.list', { exclude_archived: true, types: 'public_channel', limit: 1000 }, {
    ok: true,
    channels: [
      { name: 'chan1', num_members: 1, topic: { value: 'chan1 topic' } },
      { name: 'chan2', num_members: 2, topic: { value: 'chan2 topic' } },
      { name: 'chan3', num_members: 3, topic: { value: 'chan3 topic' } },
    ],
  });
  c.ircSocket.expect(':irslackd 322 test_slack_user #chan1 1 :chan1 topic');
  c.ircSocket.expect(':irslackd 322 test_slack_user #chan2 2 :chan2 topic');
  c.ircSocket.expect(':irslackd 322 test_slack_user #chan3 3 :chan3 topic');
  c.ircSocket.expect(':irslackd 323 test_slack_user :End of LIST');
  await c.daemon.onIrcList(c.ircUser, { args: [] });
  c.end();
  t.end();
});
