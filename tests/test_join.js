'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_join_simple', async(t) => {
  t.plan(5 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.create', { name: 'foobar', is_private: false }, {
    ok: true,
    already_in_channel: false,
    channel: {
      id: 'CFOOBAR',
      topic: {
        value: 'foobar topic here',
      },
    },
  });
  c.slackWeb.expect('conversations.members', { channel: 'CFOOBAR', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235BARR',
    'U1235BAZZ',
    'U1235QUUX',
  ]});
  c.ircSocket.expect(':test_slack_user JOIN #foobar');
  c.ircSocket.expect(':irslackd 332 test_slack_user #foobar :foobar topic here');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #foobar :test_slack_user test_slack_user test_slack_barr test_slack_bazz test_slack_quux');
  await c.daemon.onIrcJoin(c.ircUser, { args: [ '#foobar' ] });
  t.end();
});

test('irc_join_already_in', async(t) => {
  t.plan(5 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircUser.mapIrcToSlack('#foobar', 'CFOOBAR');
  c.slackWeb.expect('conversations.join', { channel: 'CFOOBAR' }, {
    ok: true,
    channel: {
      id: 'CFOOBAR',
      topic: {
        value: 'foobar topic here',
      },
    },
    warning: 'already_in_channel',
  });
  c.slackWeb.expect('conversations.members', { channel: 'CFOOBAR', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235BARR',
    'U1235BAZZ',
    'U1235QUUX',
  ]});
  c.ircSocket.expect(':test_slack_user JOIN #foobar');
  c.ircSocket.expect(':irslackd 332 test_slack_user #foobar :foobar topic here');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #foobar :test_slack_user test_slack_user test_slack_barr test_slack_bazz test_slack_quux');
  await c.daemon.onIrcJoin(c.ircUser, { args: [ '#foobar' ] });
  t.end();
});

test('irc_join_csv', async(t) => {
  t.plan(10 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  for (let chan of ['foobar', 'quuxbar']) {
    const chanId = 'C' + chan.toUpperCase();
    c.slackWeb.expect('conversations.create', { name: chan, is_private: false }, {
      ok: true,
      channel: {
        id: chanId,
        topic: { value: chan + ' topic here' },
      },
    });
    c.slackWeb.expect('conversations.members', { channel: chanId, limit: 1000 }, { ok: true, members: [
      'U1234USER',
      'U1235BARR',
      'U1235BAZZ',
      'U1235QUUX',
    ]});
    c.ircSocket.expect(':test_slack_user JOIN #' + chan);
    c.ircSocket.expect(':irslackd 332 test_slack_user #' + chan + ' :' + chan + ' topic here');
    c.ircSocket.expect(':irslackd 353 test_slack_user = #' + chan + ' :test_slack_user test_slack_user test_slack_barr test_slack_bazz test_slack_quux');
  }
  await c.daemon.onIrcJoin(c.ircUser, { args: [ '#foobar,#quuxbar' ] });
  t.end();
});

test('slack_join', async(t) => {
  t.plan(7 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.info',    { channel: 'CKOOLKEITH' }, { ok: true, channel: { id: 'CKOOLKEITH', name: 'koolkeith', topic: { value: 'kool topic here' }}});
  c.slackWeb.expect('conversations.info',    { channel: 'CKOOLKEITH' }, { ok: true, channel: { id: 'CKOOLKEITH', name: 'koolkeith', topic: { value: 'kool topic here' }}}); // TODO can be more efficient here
  c.slackWeb.expect('conversations.members', { channel: 'CKOOLKEITH', limit: 1000 }, { ok: true, members: [
    'U1234USER',
    'U1235QUUX',
    'UNEWGUY',
  ]});
  c.slackWeb.expect('users.info', { user: 'UNEWGUY' }, { ok: true, user: { name: 'newguy' }});
  c.ircSocket.expect(':test_slack_user JOIN #koolkeith');
  c.ircSocket.expect(':irslackd 332 test_slack_user #koolkeith :kool topic here');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #koolkeith :test_slack_user test_slack_user test_slack_quux newguy');
  await c.daemon.onSlackChannelJoined(c.ircUser, { channel: { id: 'CKOOLKEITH' }});
  t.end();
});

test('no_double_join', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);

  c.ircSocket.expect(':test_slack_quux JOIN #test_chan_1');
  await c.daemon.onSlackMemberJoinedChannel(c.ircUser, { channel: 'C1234CHAN1', user: 'U1235QUUX' });
  await c.daemon.onSlackMessage(c.ircUser, { subtype: 'channel_join', channel: 'C1234CHAN1', user: 'U1235QUUX' });
  t.end();
});

test('no_double_part', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);

  c.ircSocket.expect(':test_slack_barr PART #test_chan_1');
  await c.daemon.onSlackMemberLeftChannel(c.ircUser, { channel: 'C1234CHAN1', user: 'U1235BARR' });
  await c.daemon.onSlackMessage(c.ircUser, { subtype: 'channel_leave', channel: 'C1234CHAN1', user: 'U1235BARR' });
  t.end();
});
