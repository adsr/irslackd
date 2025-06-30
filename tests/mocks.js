'use strict';

const EventEmitter = require('events');
const irslackd     = require('../lib/irslackd.js');
const ircd         = require('../lib/ircd.js');

class MockIrcd extends ircd.Ircd  {
  listen(port, host) {
  }
}

class MockIrcSocket extends EventEmitter {
  constructor(t) {
    super();
    this.t = t;
    this.expectedLines = [];
    this.ended = false;
  }
  write(actualLine) {
    if (this.ended) {
      this.t.fail('Received IRCd line after socket had ended: ' + actualLine);
    }
    const testMsg = 'Expected IRCd line: ' + actualLine;
    if (this.expectedLines.length === 0) {
      this.t.fail('Expected nothing, but got IRCd line: ' + actualLine);
      return false;
    }
    let expected = this.expectedLines[0];
    if (expected.trim() !== actualLine.trim()) {
      this.t.fail('Expected IRCd line: ' + expected + ', but got: ' + actualLine);
      return false;
    }
    this.expectedLines.shift();
    this.t.ok(true, testMsg);
    return true;
  }
  end() {
    if (this.expectedLines.length !== 0) {
      this.t.fail('Expected IRCd lines were never received');
    }
    if (this.ended) {
      this.t.fail('MockIrcSocket had already ended');
    }
    this.ended = true;
  }
  expect(expectedLine) {
    console.log('expecting ' + expectedLine);
    this.expectedLines.push(expectedLine);
  }
}

class MockSlackWebClient {
  constructor(t) {
    this.t = t;
    this.expectedCalls = [];
  }
  async apiCall(actualMethod, actualOptions) {
    const testMsg = 'Expected Slack API call: ' + actualMethod + '(' + JSON.stringify(actualOptions) + ')';
    for (let i = 0; i < this.expectedCalls.length; i++) {
      let [expectedMethod, expectedOptions, result] = this.expectedCalls[i];
      if (actualMethod === expectedMethod && JSON.stringify(actualOptions) === JSON.stringify(expectedOptions)) {
        this.t.ok(true, testMsg);
        this.expectedCalls.splice(i, 1);
        return new Promise((resolve, reject) => {
          resolve(result);
        });
      }
    }
    this.t.fail(testMsg);
    return new Promise((resolve, reject) => {
      resolve({ok: false});
    });
  }
  expect(expectedMethod, expectedOptions, result) {
    this.expectedCalls.push([expectedMethod, expectedOptions, result]);
  }
}

class MockSlackRtmClient extends EventEmitter {
  constructor(t) {
    super();
    this.t = t;
  }
  start() {
  }
  disconnect() {
  }
  subscribePresence() {
  }
}

async function connectOneIrcClient(t, prefs = []) {
  // Mute test output
  console.log('# tape output off');

  // Define setExpectedSlackCalls
  const setExpectedSlackCalls = (slackWeb) => {
    slackWeb.expect('auth.test',  undefined,             { ok: true, user_id: 'U1234USER' });
    slackWeb.expect('users.info', { user: 'U1234USER' }, { ok: true, user: {
      name: 'test_slack_user',
      enterprise_user: { id: 'W1234USER' },
    }});
    slackWeb.expect('users.list', { limit: 1000 }, { ok: true, members: [
      { id: 'U1234USER', name: 'test_slack_user', deleted: false },
      { id: 'U1235FOOO', name: 'test_slack_fooo', deleted: false },
      { id: 'U1235BARR', name: 'test_slack_barr', deleted: false },
      { id: 'U1235BAZZ', name: 'test_slack_bazz', deleted: false },
      { id: 'U1235QUUX', name: 'test_slack_quux', deleted: false },
      { id: 'U1235QUU2', name: 'test_slack_quux', deleted: false }, // Test duplicate ids
    ]});
    slackWeb.expect('conversations.list', { types: 'public_channel,private_channel,mpim', limit: 1000 }, { ok: true, channels: [
      { id: 'C1234CHAN1', name: 'test_chan_1', is_member: true,  topic: { value: 'topic1' }},
      { id: 'C1235CHAN2', name: 'test_chan_2', is_member: false, topic: { value: 'topic2' }},
    ]});
    slackWeb.expect('users.setPresence', { presence: 'auto' }, { ok: true });
    slackWeb.expect('usergroups.list', { include_count: false, include_disabled: false, include_users: true, limit: 1000 }, { ok: true, usergroups: [
      { id: 'S1234GRP1', handle: '@group1', users: [ 'W1234USER' ] },
      { id: 'S1234GRP2', handle: '@group2' },
    ]});
    slackWeb.expect('conversations.members', { channel: 'C1234CHAN1', limit: 1000 }, { ok: true, members: [
      'U1234USER',
      'U1235FOOO',
      'U1235BARR',
    ]});
  };

  // Define setExpectedIrcCalls
  const setExpectedIrcCalls = (ircSocket) => {
    ircSocket.expect(':test_orig_nick NICK test_slack_user');
    ircSocket.expect(':test_slack_user JOIN #test_chan_1');
    ircSocket.expect(':irslackd 332 test_slack_user #test_chan_1 :topic1');
    ircSocket.expect(':irslackd 353 test_slack_user = #test_chan_1 :test_slack_user test_slack_user test_slack_fooo test_slack_barr');
    ircSocket.expect(':irslackd 366 test_slack_user #test_chan_1 :End of /NAMES list');
    ircSocket.expect(':irslackd 001 test_slack_user irslackd');
    ircSocket.expect(':irslackd 376 test_slack_user :End of MOTD');
  };

  // Start irslackd
  const daemon = new irslackd.Irslackd({
    host: '1.2.3.4',
    port: 1234,
    tlsOpts: {
      key: 'key',
      cert: 'cert',
    },
  });
  daemon.getNewIrcd           = (tlsOpts) => { return new MockIrcd(tlsOpts);     };
  daemon.getNewSlackRtmClient = (token)   => { return new MockSlackRtmClient(t); };
  daemon.getNewSlackWebClient = (token)   => {
    const slackWeb = new MockSlackWebClient(t);
    setExpectedSlackCalls(slackWeb);
    return slackWeb;
  };
  daemon.listen();

  // Connect IRC client
  const ircSocket = new MockIrcSocket(t);
  setExpectedIrcCalls(ircSocket);
  daemon.onIrcConnect(ircSocket);
  const ircUser = daemon.socketMap.get(ircSocket);
  t.ok(ircUser, 'Expected ircUser after onIrcConnect');

  // Send IRC connect commands
  await daemon.onIrcNick(ircUser, {args: [ 'test_orig_nick' ] });
  await daemon.onIrcPass(ircUser, {args: [ 'test_token', ...prefs ] });
  await daemon.onIrcUser(ircUser, {args: [ 'test_irc_user' ] });

  // Send Slack ready event
  await daemon.onSlackReady(ircUser, 'ready');
  t.equal(ircUser.ircNick,     'test_slack_user', 'Expected ircNick');
  t.equal(ircUser.slackToken,  'test_token',      'Expected slackToken');
  t.equal(ircUser.slackUserId, 'U1234USER',       'Expected slackUserId');
  t.looseEqual(
    Array.from(ircUser.slackUserIds),
    ['U1234USER', 'W1234USER'],
    'Expected slackUserIds (plural)',
  );
  t.ok(ircUser.slackWeb, 'Expected slackWeb');
  t.ok(ircUser.slackRtm, 'Expected slackRtm');

  // Turn test output back on
  console.log('# tape output on');

  return {
    daemon: daemon,
    ircSocket: ircSocket,
    ircUser: ircUser,
    slackWeb: ircUser.slackWeb,
    slackRtm: ircUser.slackRtm,
    end: () => ircSocket.end(),
  };
}
connectOneIrcClient.planCount = 21;

exports.MockSlackWebClient = MockSlackWebClient;
exports.MockSlackRtmClient = MockSlackRtmClient;
exports.MockIrcd = MockIrcd;
exports.MockIrcSocket = MockIrcSocket;
exports.connectOneIrcClient = connectOneIrcClient;
