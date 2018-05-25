#!/usr/bin/env node
'use strict';

/**
 * This is a very dirty smoke test to ensure a token is properly scoped for use
 * with irslackd. The test will join/leave a channel, open/close an IM, and
 * tweak the end-user's presence and profile. If things go well, things will
 * look like they did before the test ran. The test bails immediately if an
 * error is encountered.
 *
 * The test will only work if the following assumptions hold true:
 * 1. Workspace has at least 1 other user beside the end-user.
 * 2. Workspace has at least 1 bot user.
 * 3. Workspace has at least 1 public channel end-user is not a member of.
 * 4. End-user does not have the string `PROFILE` in status text.
 */

const util  = require('util');
const slack = require('@slack/client');

if (process.argv.length < 3) {
  console.log('Usage: ' + process.argv.join(' ') + ' <token>');
  process.exit(1);
}

let state = {NONE: '{}'};

const apiCalls = [
  [ 'auth.test',             'NONE', (res) => { state.MY_UID = res.user_id; } ],
  [ 'users.list',            'NONE', (res) => { res = res.members.filter(u => !u.is_bot && u.id !== state.MY_UID); if (res.length) { state.OTHER_UID = res[0].id; } } ],
  [ 'users.list',            'NONE', (res) => { res = res.members.filter(u => u.is_bot); if (res.length) { state.BOT_UID = res[0].id; } } ],
  [ 'conversations.list',    'NONE', (res) => { res = res.channels.filter(c => c.is_channel && !c.is_private && !c.is_member); if (res.length) { state.CHAN_CID = res[0].id; state.CHAN_NAME = res[0].name; } } ],
  [ 'usergroups.list',       'NONE' ],
  [ 'im.open',               '{"user": "OTHER_UID"}', (res) => { state.IM_CID = res.channel.id; } ],
  [ 'im.close',              '{"channel": "IM_CID"}' ],
  [ 'users.info',            '{"user": "OTHER_UID"}' ],
  [ 'users.profile.get',     '{"user": "MY_UID"}', (res) => { state.PROFILE = res.profile.status_text; state.EMOJI = res.profile.status_emoji; } ],
  [ 'users.profile.set',     '{"user": "MY_UID", "profile": {"status_text": "test", "status_emoji": ":sunglasses:"}}' ],
  [ 'users.profile.set',     '{"user": "MY_UID", "profile": {"status_text": "PROFILE", "status_emoji": "EMOJI"}}' ],
  [ 'users.setPresence',     '{"user": "MY_UID", "presence": "auto"}' ],
  [ 'channels.join',         '{"name": "#CHAN_NAME"}' ],
  [ 'channels.leave',        '{"channel": "CHAN_CID"}' ],
  [ 'conversations.info',    '{"channel": "CHAN_CID"}' ],
  [ 'conversations.members', '{"channel": "CHAN_CID"}' ],
  [ 'users.info',            '{"user": "BOT_UID"}', (res) => { state.BOT_BID = res.user.profile.bot_id; } ],
  [ 'bots.info',             '{"bot": "BOT_BID"}' ],
];

const slackToken = process.argv[2];
const slackWeb = new slack.WebClient(slackToken);

(async() => {
  for (let i = 0; i < apiCalls.length; ++i) {
    try {
      let [method, optsJson, processFn] = apiCalls[i];
      let realJson = optsJson;
      for (var key in state) if (state.hasOwnProperty(key)) {
        realJson = realJson.replace(key, state[key]);
      }
      if (realJson === optsJson) {
        throw Error('Missing param for ' + util.inspect(apiCalls[i]));
      }
      console.log('Calling: ' + method + '(' + realJson + ')');
      const options = JSON.parse(realJson);
      const res = await slackWeb.apiCall(method, options);
      if (!res.ok) throw res;
      if (processFn) processFn(res);
    } catch (e) {
      console.error(util.inspect(e));
      console.log(util.inspect(state));
      process.exit(1);
    }
  }
  console.log("Looks OK!");
})();
