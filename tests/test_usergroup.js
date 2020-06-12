'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('slack_usergroup_updated', async(t) => {
  t.plan(1 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  await c.daemon.onSlackSubteamUpdated(c.ircUser, {
    type: 'subteam_updated',
    subteam: {
      id: 'S1234GRP1',
      handle: 'newgroup1',
    },
  });
  c.slackWeb.expect('chat.postMessage', {
    channel: 'C1234CHAN1',
    text: 'hello <!subteam^S1234GRP1|@newgroup1>',
    as_user: true,
    thread_ts: null,
  }, {
    ok: true,
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  await c.daemon.onIrcPrivmsg(c.ircUser, { args: [ '#test_chan_1', 'hello @newgroup1' ] });
  await c.daemon.onSlackMessage(c.ircUser, {
    text: 'hello world <!subteam^S1234GRP1|@newgroup1>',
    user: 'U1234USER',
    channel: 'C1234CHAN1',
    ts: '1234.5678',
  });
  c.end();
  t.end();
});
