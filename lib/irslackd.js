"use strict";

const slack = require('@slack/client'),
      ircd  = require('./ircd-single'),
      util  = require('util');

class Irslackd {
  constructor() {
    this.socket = null;
  }
  run(config) {
    const self = this;

    // Init IRC
    self.ircd = new ircd.IrcdSingle();
    new Map([
      [ 'NICK',    self.onIrcNick    ],
      [ 'USER',    self.onIrcUser    ],
      [ 'JOIN',    self.onIrcJoin    ],
      [ 'PART',    self.onIrcPart    ],
      [ 'PRIVMSG', self.onIrcPrivmsg ],
      [ 'PING',    self.onIrcPing    ],
      [ 'QUIT',    self.onIrcQuit    ],
      [ 'msg',     self.onIrcMsg     ],
      [ 'line',    self.onIrcLine    ],
      [ 'error',   self.onIrcError   ],
    ]).forEach((method, cmd, map) => {
      self.ircd.on(cmd, (msg) => {
        method.call(self, msg);
      });
    });
    self.ircd.listen(config.port, config.host);
    self.ircNick = 'user';

    // Init Slack
    self.slackWeb = new slack.WebClient(config.token);
    self.slackRtm = new slack.RTMClient(config.token);
    new Map([
      [ 'ready',                 self.onSlackReady               ],
      [ 'message',               self.onSlackMessage             ],
      [ 'channel_joined',        self.onSlackChannelJoined       ],
      [ 'channel_left',          self.onSlackChannelLeft         ],
      [ 'member_joined_channel', self.onSlackMemberJoinedChannel ],
      [ 'member_left_channel',   self.onSlackMemberLeftchannel   ],
      [ 'slack_event',           self.onSlackEvent               ],
    ]).forEach((method, event, map) => {
      self.slackRtm.on(event, (event) => {
        method.call(self, event);
      });
    });
    self.slackRtm.start();
  }
  onIrcNick(msg) {
    self.ircNick = msg.args[0] || 'user';
  }
  onIrcUser(msg) {
    self.ircd.write('irslackd', '001', self.ircNick, 'irslackd');
    self.ircd.write('irslackd', '376', self.ircNick, 'End of MOTD');
  }
  async onIrcJoin(msg) {
  }
  onIrcPart(msg) {
  }
  onIrcPrivmsg(msg) {
  }
  onIrcPing(msg) {
  }
  onIrcQuit(msg) {
  }
  async onSlackReady(event) {
    let convos, users;
    try {
      convos = this.slackWeb.conversations.list();
      users = this.slackWeb.users.list();
    } catch (e) {
      this.onSlackErr(e);
      return;
    }
    convos = await convos;
    users = await users;
    console.log('convos', util.inspect(convos));
    console.log('users', util.inspect(users));
  }
  onSlackMessage(event) {
  }
  onSlackChannelJoined(event) {
  }
  onSlackChannelLeft(event) {
  }
  onSlackMemberJoinedChannel(event) {
  }
  onSlackMemberLeftchannel(event) {
  }
  onIrcMsg(msg) {
    console.log('irc_msg', util.inspect(msg));
  }
  onIrcLine(line) {
    console.log('irc_line', line);
  }
  onIrcError(err) {
    console.log('irc_err', err);
  }
  onSlackEvent(event) {
    console.log('slack_event', util.inspect(event));
  }
  onSlackError(err) {
    console.log('slack_err', err);
  }
  makeIrcLineScanner() {
    let buffer = '';
    return function(data) {
      buffer += data;
      let lines = buffer.split(/\r?\n/);
      if (lines.length >= 2) {
        for (let i = 0; i <= lines.length - 2; i++) {
          self.onIrcLine(lines[i]);
        }
        buffer = lines[lines.length - 1]
      }
    };
  }

}

exports.Irslackd = Irslackd;
