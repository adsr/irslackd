'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('irc_handler', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  let marker = false;
  c.daemon.ircd.on('__test_event', c.daemon.makeIrcHandler((ircUser, param) => {
    t.equal(ircUser, c.ircUser, 'Expected ircUser in IRC handler');
    t.equal(param, 42, 'Expected param in IRC handler');
    marker = true;
  }));
  c.daemon.ircd.emit('__test_event', c.ircSocket, 42);
  let maxChecks = 10;
  (function checkMarker() {
    if (marker) {
      c.end();
      t.end();
    } else if (maxChecks--) {
      console.log('Sleeping...');
      setTimeout(checkMarker, 100);
    } else {
      t.fail('Event did not trigger');
    }
  })();
});

test('slack_handler', async(t) => {
  t.plan(2 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  let marker = false;
  c.slackRtm.on('__test_event', c.daemon.makeSlackHandler((ircUser, param) => {
    t.equal(ircUser, c.ircUser, 'Expected ircUser in IRC handler');
    t.equal(param, 42, 'Expected param in IRC handler');
    marker = true;
  }));
  c.slackRtm.emit('__test_event', 42);
  let maxChecks = 10;
  (function checkMarker() {
    if (marker) {
      c.end();
      t.end();
    } else if (maxChecks--) {
      console.log('Sleeping...');
      setTimeout(checkMarker, 100);
    } else {
      t.fail('Event did not trigger');
    }
  })();
});
