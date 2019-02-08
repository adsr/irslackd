'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('connect_simple', async(t) => {
  t.plan(mocks.connectOneIrcClient.planCount);
  await mocks.connectOneIrcClient(t);
  t.end();
});
