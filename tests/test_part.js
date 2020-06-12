'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_part', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.leave', { channel: 'C1234CHAN1' }, { ok: true });
  c.ircSocket.expect(':test_slack_user PART #test_chan_1');
  await c.daemon.onIrcPart(c.ircUser, { args: [ '#test_chan_1' ] });
  c.end();
  t.end();
});

test('slack_part', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.leave', { channel: 'C1234CHAN1' }, { ok: true });
  c.ircSocket.expect(':test_slack_user PART #test_chan_1');
  await c.daemon.onSlackChannelLeft(c.ircUser, { channel: 'C1234CHAN1' });
  c.end();
  t.end();
});
