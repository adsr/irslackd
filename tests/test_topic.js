'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_topic', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircUser.mapIrcToSlack('#fun_channel', 'C1234CHAN1');
  c.slackWeb.expect('conversations.setTopic',
    { channel: 'C1234CHAN1',
      topic: 'new topic' },
    { ok: true });
  c.ircSocket.expect(':irslackd 332 test_slack_user #fun_channel :new topic');
  await c.daemon.onIrcTopic(c.ircUser, { args: ['#fun_channel', 'new topic'] });
  t.end();
});
