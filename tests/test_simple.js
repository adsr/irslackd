'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('simple connect', function(t) {
  mocks.connectOneIrcClient(t);
  t.end();
});
