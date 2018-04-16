#!/usr/bin/env node
'use strict';

const irslackd = require('../lib/irslackd.js');

new irslackd.Irslackd().run({
  host: process.env.IRSLACKD_LISTEN_HOST || '0.0.0.0',
  port: process.env.IRSLACKD_LISTEN_PORT || 6667,
});
