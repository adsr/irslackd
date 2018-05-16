#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const irslackd = require('../lib/irslackd.js');

new irslackd.Irslackd({
  host: process.env.IRSLACKD_LISTEN_HOST || '0.0.0.0',
  port: process.env.IRSLACKD_LISTEN_PORT || 6697,
  tlsOpts: {
    key: fs.readFileSync(process.env.IRSLACKD_TLS_PKEY || (os.homedir() + '/.irslackd/pkey.pem')),
    cert: fs.readFileSync(process.env.IRSLACKD_TLS_CERT || (os.homedir() + '/.irslackd/cert.pem')),
  },
}).listen();
