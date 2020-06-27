'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('slack_mpim_open', async(t) => {
  t.plan(7 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.info', { channel: 'G1234GROUP' }, {
    ok: true,
    channel: {
      id: 'G1234GROUP',
      name: 'mpdm-test_slack_user--user2--user3--user4-1',
      topic: { value: 'Group messaging' },
    },
  });
  c.slackWeb.expect('conversations.info', { channel: 'G1234GROUP' }, { // TODO avoid conversations.info twice in mpim_open
    ok: true,
    channel: {
      id: 'G1234GROUP',
      name: 'mpdm-test_slack_user--user2--user3--user4-1',
      topic: { value: 'Group messaging' },
    },
  });
  c.slackWeb.expect('conversations.members', { channel: 'G1234GROUP', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235BARR',
    'U1235BAZZ',
    'U1235QUUX',
  ]});
  c.ircSocket.expect(':test_slack_user JOIN #mpdm-test_slack_user--user2--user3--user4-1');
  c.ircSocket.expect(':irslackd 332 test_slack_user #mpdm-test_slack_user--user2--user3--user4-1 :Group messaging');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #mpdm-test_slack_user--user2--user3--user4-1 :test_slack_user test_slack_user test_slack_barr test_slack_bazz test_slack_quux');
  c.ircSocket.expect(':irslackd 366 test_slack_user #mpdm-test_slack_user--user2--user3--user4-1 :End of /NAMES list');
  await c.daemon.onSlackMpimOpen(c.ircUser, {
    user: 'U1234USER',
    channel: 'G1234GROUP',
    type: 'mpim_open',
    is_mpim: true,
    event_ts: '1234.5678',
  }, {
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_short_group_chat_names', async(t) => {
  t.plan(7 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t, ['short-group-chat-names']);
  c.slackWeb.expect('conversations.info', { channel: 'G1234GROUP' }, {
    ok: true,
    channel: {
      id: 'G1234GROUP',
      name: 'mpdm-test_slack_user--user2--user3--user4-1',
      topic: { value: 'Group messaging' },
    },
  });
  c.slackWeb.expect('conversations.info', { channel: 'G1234GROUP' }, { // TODO avoid conversations.info twice in mpim_open
    ok: true,
    channel: {
      id: 'G1234GROUP',
      name: 'mpdm-test_slack_user--user2--user3--user4-1',
      topic: { value: 'Group messaging' },
    },
  });
  c.slackWeb.expect('conversations.members', { channel: 'G1234GROUP', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235BARR',
    'U1235BAZZ',
    'U1235QUUX',
  ]});
  c.ircSocket.expect(':test_slack_user JOIN &user2-user3-user4-1');
  c.ircSocket.expect(':irslackd 332 test_slack_user &user2-user3-user4-1 :Group messaging');
  c.ircSocket.expect(':irslackd 353 test_slack_user = &user2-user3-user4-1 :test_slack_user test_slack_user test_slack_barr test_slack_bazz test_slack_quux');
  c.ircSocket.expect(':irslackd 366 test_slack_user &user2-user3-user4-1 :End of /NAMES list');
  await c.daemon.onSlackMpimOpen(c.ircUser, {
    user: 'U1234USER',
    channel: 'G1234GROUP',
    type: 'mpim_open',
    is_mpim: true,
    event_ts: '1234.5678',
  }, {
    ts: '1234.5678',
  });
  c.end();
  t.end();
});
