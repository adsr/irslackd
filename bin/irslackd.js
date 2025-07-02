#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const irslackd = require('../lib/irslackd.js');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 6697;
const DEFAULT_TLS_PKEY = os.homedir() + '/.irslackd/pkey.pem';
const DEFAULT_TLS_CERT = os.homedir() + '/.irslackd/cert.pem';
const DEFAULT_RTM_CLIENT_LOG_LEVEL = 'info';
const DEFAULT_LINE_LEN = 4096;

const opt = require('node-getopt').create([
  [ 'h', 'help',            'Show this help' ],
  [ 'p', 'port=PORT',       'Set listen port (default: ' + DEFAULT_PORT + ')' ],
  [ 'a', 'host=ADDR',       'Set listen address (default: ' + DEFAULT_HOST + ')' ],
  [ 'k', 'privkey=PATH',    'Set TLS private key path (default: ' + DEFAULT_TLS_PKEY + ')' ],
  [ 'c', 'cert=PATH',       'Set TLS cert path (default: ' + DEFAULT_TLS_CERT + ')' ],
  [ 'L', 'rtmLogLvl=LEVEL', 'Set RTM Client log level (default: ' + DEFAULT_RTM_CLIENT_LOG_LEVEL + ')' ],
  [ 'i', 'insecure',        'Do not use TLS encryption (not recommended)' ],
  [ 'l', 'lineLen',         'Set RPL_ISUPPORT LINELEN (default: ' + DEFAULT_LINE_LEN + ')' ],
]).bindHelp().parseSystem();

new irslackd.Irslackd({
  host: opt.options.host || DEFAULT_HOST,
  port: opt.options.port || DEFAULT_PORT,
  tlsOpts: opt.options.insecure ? false : {
    key: fs.readFileSync(opt.options.privkey || DEFAULT_TLS_PKEY),
    cert: fs.readFileSync(opt.options.cert || DEFAULT_TLS_CERT),
  },
  rtmClientLogLevel: opt.options.rtmLogLvl || DEFAULT_RTM_CLIENT_LOG_LEVEL,
  lineLen: opt.options.lineLen || DEFAULT_LINE_LEN,
}).listen();
