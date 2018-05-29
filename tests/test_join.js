'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_join_one', async function(t) {
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('channels.join',         { name: 'foobar' },     { ok: true, channel: { id: 'CFOOBAR' }});
  c.slackWeb.expect('conversations.info',    { channel: 'CFOOBAR' }, { ok: true, channel: { id: 'CFOOBAR', topic: { value: 'foobar topic here' }}});
  c.slackWeb.expect('conversations.members', { channel: 'CFOOBAR' }, { ok: true, members: [
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

test('irc_join_two', async function(t) {
  const c = await mocks.connectOneIrcClient(t);
  for (let chan of ['foobar', 'quuxbar']) {
    const chanId = 'C' + chan.toUpperCase();
    c.slackWeb.expect('channels.join',         { name: chan },     { ok: true, channel: { id: chanId }});
    c.slackWeb.expect('conversations.info',    { channel: chanId }, { ok: true, channel: { id: chanId, topic: { value: chan + ' topic here' }}});
    c.slackWeb.expect('conversations.members', { channel: chanId }, { ok: true, members: [
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

test('slack_join', async function(t) {
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('conversations.info',    { channel: 'CKOOLKEITH' }, { ok: true, channel: { id: 'CKOOLKEITH', name: 'koolkeith', topic: { value: 'kool topic here' }}});
  c.slackWeb.expect('conversations.info',    { channel: 'CKOOLKEITH' }, { ok: true, channel: { id: 'CKOOLKEITH', name: 'koolkeith', topic: { value: 'kool topic here' }}}); // TODO can be more efficient here
  c.slackWeb.expect('conversations.members', { channel: 'CKOOLKEITH' }, { ok: true, members: [
    'U1234USER',
    'U1235QUUX',
    'UNEWGUY',
  ]});
  c.slackWeb.expect('users.info', { user: 'UNEWGUY' }, { ok: true, user: { name: 'newguy' }});
  c.ircSocket.expect(':test_slack_user JOIN #koolkeith');
  c.ircSocket.expect(':irslackd 332 test_slack_user #koolkeith :kool topic here');
  c.ircSocket.expect(':irslackd 353 test_slack_user = #koolkeith :test_slack_user test_slack_user test_slack_quux newguy');
  await c.daemon.onSlackChannelJoined(c.ircUser, { channel: 'CKOOLKEITH' });
  t.end();
});
