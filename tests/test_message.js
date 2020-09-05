'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_privmsg', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello world',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello world' ] });
  console.log('Expect no-op from onSlackMessage (preventSelfEcho)');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('irc_privmsg_with_err', async(t) => {
  t.plan(3 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello world',
    as_user: true,
    thread_ts: null,
  }, {
    ok: false,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  try {
    await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello world' ] });
  } catch (e) {
    t.ok(e, 'Expected exception because ok==false');
  }
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello world after error',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello world after error' ] });
  c.end();
  t.end();
});

test('slack_privmsg', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello world');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_delete_image', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :\x01ACTION deletes:\x01');
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :\x01ACTION > https://site.com/image.jpg\x01');
  await c.daemon.onSlackMessage(c.ircUser, {
    type: 'message',
    subtype: 'message_deleted',
    channel: 'C1234CHAN1',
    previous_message: {
      type: 'message',
      text: '',
      user: 'U1234USER',
      files: [{
        url_private: 'https://site.com/image.jpg',
      }],
    },
    ts: '1234.5678',
  });
});

test('slack_ircize_text', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello @test_slack_bazz in #test_chan_1');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <@U1235BAZZ> in <#C1234CHAN1|test_chan_1>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_ircize_text_backticks', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello ```<@U1235BAZZ>``` in #test_chan_1 `user <@U1235BAZZ>` your email is aa@bb.cc winner of `award');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello ```<@U1235BAZZ>``` in <#C1234CHAN1|test_chan_1> `user <@U1235BAZZ>` your email is <mailto:aa@bb.cc|not@this.com> winner of `award',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_ircize_text_backticks_two', async(t) => {
  t.plan(5 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :```ERROR:  error one');
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :ERROR:  error two');
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :ERROR:  error three');
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :ERROR:  error four');
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :DANGER!  ssh <mailto:bob@builder.com|bob@builder.com> bad command had an exit value of: 23```');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: '```ERROR:  error one\nERROR:  error two\nERROR:  error three\nERROR:  error four\nDANGER!  ssh <mailto:bob@builder.com|bob@builder.com> bad command had an exit value of: 23```',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('irc_slackize_text', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello <@U1235BAZZ> in <#C1234CHAN1|test_chan_1>',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello @test_slack_bazz in #test_chan_1' ] });
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <@U1235BAZZ> in <#C1234CHAN1|test_chan_1>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('irc_no_slackize_text', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello@test_slack_bazzin#test_chan_1',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello@test_slack_bazzin#test_chan_1' ] });
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello@test_slack_bazzin#test_chan_1',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_ircize_here', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello @here ');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <!here>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('irc_slackize_here', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello <!here>',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello @here' ] });
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <!here>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('slack_ircize_channel', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.ircSocket.expect(':test_slack_user PRIVMSG #test_chan_1 :hello @channel');
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <!channel>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});

test('irc_slackize_channel', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello <!channel>',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello @channel' ] });
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello <!channel>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});
