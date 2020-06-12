'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_topic_set', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.setTopic', {
    channel: 'C1234CHAN1',
    topic: 'new topic',
  }, {
    ok: true,
    channel: { topic: { value: 'new topic diff' }},
  });

  c.ircSocket.expect(':irslackd 332 test_slack_user #test_chan_1 :new topic diff');
  await c.daemon.onIrcTopic(c.ircUser, { args: [ '#test_chan_1', 'new topic' ] });

  c.end();
  t.end();
});

test('irc_topic_get', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);

  c.slackWeb.expect('conversations.info', {
    channel: 'C1234CHAN1',
  }, {
    ok: true,
    channel: { topic: { value: 'whatever topic' }},
  });

  c.ircSocket.expect(':irslackd 332 test_slack_user #test_chan_1 :whatever topic');
  await c.daemon.onIrcTopic(c.ircUser, { args: [ '#test_chan_1' ] });

  c.end();
  t.end();
});
