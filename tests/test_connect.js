'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('connect', function(t) {
  mocks.connectOneIrcClient(t);
  t.end();
});
