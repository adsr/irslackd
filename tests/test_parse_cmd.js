'use strict';

const test = require('tape');
const mocks = require('./mocks');

test('parse_at_slack_command', async(t) => {
  t.plan(21 + mocks.connectOneIrcClient.planCount);
  const c = await mocks.connectOneIrcClient(t);
  t.deepEqual(c.daemon.parseAtSlackCmd('hello'),                        [{}, ['hello']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('hello there'),                  [{}, ['hello', 'there']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('a long phrase of words'),       [{}, ['a', 'long', 'phrase', 'of', 'words']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('hello   there'),                [{}, ['hello', 'there']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('   hello   there'),             [{}, ['hello', 'there']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-a 1 -b 2 --cd=3a'),            [{a: '1', b: '2', cd: '3a'}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-a   1   -b 2 --cd=3a ok'),     [{a: '1', b: '2', cd: '3a'}, ['ok']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-a "  1" -b 2 --cd=3a ok'),     [{a: '  1', b: '2', cd: '3a'}, ['ok']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('--no -param'),                  [{no: true, param: true}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('--yes param'),                  [{yes: 'param'}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('ok1 -a 1 -b 2 --cd=3a ok2'),    [{a: '1', b: '2', cd: '3a'}, ['ok1', 'ok2']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('"quote-test " -quote=test'),    [{quote: 'test'}, ['quote-test ']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('one\\ arg'),                    [{}, ['one arg']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('"quote\\"arg"'),                [{}, ['quote"arg']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-param=one\\ arg end'),         [{param: 'one arg'}, ['end']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing=0  '),                [{trailing: '0'}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing=0  -x'),              [{trailing: '0', x: true}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing=0  x'),               [{trailing: '0'}, ['x']]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing='),                   [{trailing: true}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing'),                    [{trailing: true}, []]);
  t.deepEqual(c.daemon.parseAtSlackCmd('-trailing=""'),                 [{trailing: ''}, []]);
  t.end();
});
