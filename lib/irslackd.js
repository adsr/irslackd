'use strict';

const util      = require('util');
const slack     = require('@slack/client');
const AwaitLock = require('await-lock');
const ircd      = require('./ircd');
const refresh   = require('./slack-refresh');

class Irslackd {
  constructor() {
    this.socket = null;
  }
  run(config) {
    const self = this;
    self.rtmMap = new Map();
    self.socketMap = new Map();
    self.ircd = new ircd.Ircd(config.tlsOpts);
    new Map([
      [ 'AWAY',    self.makeIrcHandler(self.onIrcAway)    ],
      [ 'JOIN',    self.makeIrcHandler(self.onIrcJoin)    ],
      [ 'NICK',    self.makeIrcHandler(self.onIrcNick)    ],
      [ 'PART',    self.makeIrcHandler(self.onIrcPart)    ],
      [ 'PASS',    self.makeIrcHandler(self.onIrcPass)    ],
      [ 'PRIVMSG', self.makeIrcHandler(self.onIrcPrivmsg) ],
      [ 'PING',    self.makeIrcHandler(self.onIrcPing)    ],
      [ 'QUIT',    self.makeIrcHandler(self.onIrcQuit)    ],
      [ 'USER',    self.makeIrcHandler(self.onIrcUser)    ],
      [ 'msg',     self.makeIrcHandler(self.onIrcMsg)     ],
      [ 'line',    self.makeIrcHandler(self.onIrcLine)    ],
      [ 'error',   self.makeIrcHandler(self.onIrcError)   ],
      [ 'close',   self.makeIrcHandler(self.onIrcClose)   ],
      [ 'connect', (socket) => { self.onIrcConnect(socket); } ],
    ]).forEach((handler, cmd, map) => {
      self.ircd.on(cmd, handler);
    });
    self.ircd.listen(config.port, config.host);
  }
  onIrcConnect(socket) {
    this.socketMap.set(socket, new IrcUser(socket));
  }
  onIrcClose(ircUser, socket, hadError) {
    this.socketMap.delete(socket);
    this.rtmMap.delete(ircUser.slackRtm);
    ircUser.slackRtm.disconnect();
    this.setSlackPresence(ircUser, false);
  }
  onIrcPass(ircUser, msg) {
    ircUser.slackToken = msg.args[0] || '';
  }
  onIrcNick(ircUser, msg) {
    ircUser.ircNick = msg.args[0] || 'user';
  }
  async onIrcUser(ircUser, msg) {
    const self = this;
    ircUser.slackWeb = new slack.WebClient(ircUser.slackToken); // TODO logLevel: 'trace'
    ircUser.slackWeb.paginateCall = self.paginateCall;
    ircUser.slackRtm = new slack.RTMClient(ircUser.slackToken);

    // Identify end-user
    let auth;
    try {
      auth = await ircUser.slackWeb.apiCall('auth.test');
      if (!auth.ok) throw auth;
    } catch (e) {
      this.logError(ircUser, 'Failed auth.test: ' + util.inspect(e));
      return;
    }
    ircUser.slackUserId = auth.user_id;
    ircUser.ircNick = (await this.resolveSlackUser(ircUser, ircUser.slackUserId)) || ircUser.ircNick;

    // Setup Slack handlers
    self.rtmMap.set(ircUser.slackRtm, ircUser);
    new Map([
      [ 'ready',                 self.makeSlackHandler(self.onSlackReady)               ],
      [ 'message',               self.makeSlackHandler(self.onSlackMessage)             ],
      [ 'channel_joined',        self.makeSlackHandler(self.onSlackChannelJoined)       ],
      [ 'channel_left',          self.makeSlackHandler(self.onSlackChannelLeft)         ],
      [ 'member_joined_channel', self.makeSlackHandler(self.onSlackMemberJoinedChannel) ],
      [ 'member_left_channel',   self.makeSlackHandler(self.onSlackMemberLeftchannel)   ],
      [ 'reaction_added',        self.makeSlackHandler(self.onSlackReactionAdded)       ],
      [ 'slack_event',           self.makeSlackHandler(self.onSlackEvent)               ],
    ]).forEach((handler, event, map) => {
      ircUser.slackRtm.on(event, handler);
    });

    // Start RTM
    ircUser.slackRtm.start();
  }
  async onIrcAway(ircUser, msg) {
      // if args is empty, unset away status
      let status;
      if (msg.args.length == 0) {
          status = '';
          this.setSlackPresence(ircUser, true);
      } else {
          status = msg.args[0];
          // slack statuses are capped at 100 characters
          status = status.substring(0, 100);
          this.setSlackPresence(ircUser, false);
      }
      let profile;
      try {
          profile = await ircUser.slackWeb.apiCall('users.profile.set', { profile: { status_text: status , status_emoji: '' } });
          if (!profile.ok) throw profile;
      } catch(e) {
          this.logError(ircUser, 'Failed users.profile.set: ' + util.inspect(e));
      }
  }
  async onIrcJoin(ircUser, msg) {
    let ircChan = msg.args[0];

    // Join Slack channel
    let slackChan = ircChan;
    if (slackChan.substr(0, 1) === '#') slackChan = slackChan.substr(1);
    let convo;
    try {
      convo = await ircUser.slackWeb.apiCall('channels.join', { name: slackChan });
      if (!convo.ok) throw convo;
    } catch (e) {
      this.logError(ircUser, 'Failed channels.join: ' + util.inspect(e));
      return;
    }

    // Bail if already in channel on Slack and IRC
    if (convo.already_in_channel && ircUser.inChannel.get(ircChan)) {
      return;
    }

    // Call conversations.info if already_in_channel
    // (channels.join returns limited channel info in this case)
    if (convo.already_in_channel) {
      try {
        convo = await ircUser.slackWeb.apiCall('conversations.info', { name: slackChan });
        if (!convo.ok) throw convo;
      } catch (e) {
        this.logError(ircUser, 'Failed conversations.info: ' + util.inspect(e));
        return;
      }
    }

    // Update maps
    ircUser.ircToSlack.set(ircChan, convo.channel.id);
    ircUser.slackToIrc.set(convo.channel.id, ircChan);

    // Get Slack channel members
    let members;
    try {
      members = await ircUser.slackWeb.paginateCall('conversations.members', 'members', { channel: convo.channel.id });
      if (!members.ok) throw members;
    } catch (e) {
      this.logError(ircUser, 'Failed conversations.members: ' + util.inspect(e));
      return;
    }

    // Assemble IRC nicks
    let ircNicks = [ ircUser.ircNick ];
    members.members.forEach((userId) => {
      let ircNick = ircUser.slackToIrc.get(userId);
      if (ircNick) {
        ircNicks.push(ircNick);
      } else {
        this.logError(ircUser, 'No user for userId ' + userId);
      }
    });

    // Set inChannel marker
    ircUser.inChannel.set(ircChan, true);

    // Join IRC channel
    this.ircd.write(ircUser.socket, ircUser.ircNick, 'JOIN', [ ircChan ]);
    if (convo.channel.topic && convo.channel.topic.value) {
      this.ircd.write(ircUser.socket, 'irslackd', '332', [ '=', ircChan, ':' + convo.channel.topic.value ]);
    }
    this.ircd.write(ircUser.socket, 'irslackd', '353', [ '=', ircChan, ircNicks.join(' ') ]);
  }
  async onIrcPart(ircUser, msg) {
    let ircChan = msg.args[0];

    // Bail if Slack channel not in map
    let slackChan = ircUser.ircToSlack.get(ircChan);
    if (!slackChan) {
      this.logError(ircUser, 'No entry in ircToSlack for channel ' + ircChan);
      return;
    }

    // Leave Slack channel
    let convo;
    try {
      convo = await ircUser.slackWeb.apiCall('conversations.leave', { channel: slackChan });
      if (!convo.ok) throw convo;
    } catch (e) {
      this.logError(ircUser, 'Failed conversations.leave: ' + util.inspect(e));
      return;
    }

    // Unset inChannel marker
    ircUser.inChannel.delete(ircChan);

    // Leave IRC channel
    this.ircd.write(ircUser.socket, ircUser.ircNick, 'PART', [ ircChan ]);
  }
  async onIrcPrivmsg(ircUser, msg) {
    let target = msg.args[0];
    let message = msg.args[1];

    // Resolve target as Slack channel
    let slackChan;
    try {
      let slackTarget = ircUser.ircToSlack.get(target);
      if (!slackTarget) throw Error('No entry in ircToSlack for target ' + target);
      if (target.substr(0, 1) === '#') {
        slackChan = slackTarget;
      } else {
        let im = await ircUser.slackWeb.apiCall('im.open', { user: slackTarget });
        if (!im.ok) throw im;
        slackChan = im.channel.id;
      }
    } catch (e) {
      this.logError(ircUser, 'Failed to resolve privmsg target: ' + util.inspect(e));
      return;
    }

    // Update maps
    ircUser.slackToIrc.set(target, slackChan);
    ircUser.ircToSlack.set(slackChan, target);

    // Check for /me message
    let apiMethod = 'chat.postMessage';
    if (message.charCodeAt(0) === 1 && message.substr(1, 7) === 'ACTION ') {
      apiMethod = 'chat.meMessage';
      message = message.substr(8);
      if (message.charCodeAt(message.length - 1) === 1) {
        message = message.substr(0, message.length - 1);
      }
    }

    // Call chat.(post|me)Message
    try {
      await this.rememberSelfEcho(ircUser, message, () => {
        return ircUser.slackWeb.apiCall(apiMethod, {
          channel: slackChan,
          text: message,
          as_user: true,
        });
      });
    } catch (e) {
      this.logError(ircUser, 'Failed ' + apiMethod + ': ' + util.inspect(e));
    }
  }
  onIrcPing(ircUser, msg) {
    // Send PONG
    this.ircd.write(ircUser.socket, 'irslackd', 'PONG', [ 'irslackd' ]);
  }
  onIrcQuit(ircUser, msg) {
    // Close link
    this.ircd.write(ircUser.socket, 'irslackd', 'ERROR', [ 'Closing Link' ]);
    ircUser.socket.end();
  }
  async onSlackReady(ircUser, event) {
    // Send MOTD
    this.ircd.write(ircUser.socket, 'irslackd', '001', [ ircUser.ircNick, 'irslackd' ]);
    this.ircd.write(ircUser.socket, 'irslackd', '376', [ ircUser.ircNick, 'End of MOTD' ]);

    // set user presence to auto instead of away
    this.setSlackPresence(ircUser, true);

    // Refresh Slack users and channels
    // Await on usernames as they are needed before populating channels
    try {
      await refresh.refreshUsers.call(this, ircUser);
      refresh.refreshChannels.call(this, ircUser);
    } catch (e) {
      this.logError(ircUser, e);
    }
  }
  async onSlackMessage(ircUser, event) {
    // Delegate certain messages
    if (event.subtype === 'channel_join') {
      return this.onSlackMemberJoinedChannel(ircUser, event);
    } else if (event.subtype === 'channel_left') {
      return this.onSlackMemberLeftChannel(ircUser, event);
    } else if (event.subtype === 'channel_topic' || event.subtype === 'group_topic') {
      return this.onSlackTopicChange(ircUser, event);
    }

    // Prevent self-echo
    if (await this.preventSelfEcho(ircUser, event, event.text)) return;

    // Make certain messages appear as `/me` actions
    if (event.subtype === 'message_changed') {
      event.user = event.message.user;
      event.text = 'edits: ' + event.message.text;
      event.subtype = 'me_message';
    } else if (event.subtype === 'message_deleted') {
      event.user = event.previous_message.user;
      event.text = 'deletes: ' + event.previous_message.text;
      event.subtype = 'me_message';
    }

    // Get nick and channel
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (!ircNick || !ircChan) return;

    // Write message, checking for `/me` commands
    let message;
    if (event.subtype === 'me_message') {
      message = this.meMessage(event.text);
    } else {
      message = event.text;
    }
    this.ircd.write(ircUser.socket, ircNick, 'PRIVMSG', [ ircChan, ':' + message ]);
  }
  async onSlackTopicChange(ircUser, event) {
    // Get nick and channel
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (!ircNick || !ircChan) return;

    // Send topic message
    this.ircd.write(ircUser.socket, ircNick, 'TOPIC', [ ircChan, event.topic ]);
  }
  async onSlackChannelJoined(ircUser, event) {
    let ircChan = await this.resolveSlackChannel(ircUser, event.channel);
    if (ircChan) {
      this.onIrcJoin(ircUser, { args: [ ircChan ] });
    }
  }
  async onSlackChannelLeft(ircUser, event) {
    let ircChan = await this.resolveSlackChannel(ircUser, event.channel);
    if (ircChan) {
      this.onIrcPart(ircUser, { args: [ ircChan ] });
    }
  }
  async onSlackMemberJoinedChannel(ircUser, event) {
    if (event.user === ircUser.slackUserId) return;
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (ircNick && ircChan) {
      this.ircd.write(ircUser.socket, ircNick, 'JOIN', [ ircChan ]);
    }
  }
  async onSlackMemberLeftchannel(ircUser, event) {
    if (event.user === ircUser.slackUserId) return;
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (ircNick && ircChan) {
      this.ircd.write(ircUser.socket, ircNick, 'PART', [ ircChan ]);
    }
  }
  async onSlackReactionAdded(ircUser, event) {
    if (event.item.type !== 'message') {
      return;
    }
    let ircReacter = this.resolveSlackUser(ircUser, event.user);
    let ircReactee = this.resolveSlackUser(ircUser, event.item_user);
    let ircChan    = this.resolveSlackChannel(ircUser, event.item.channel);
    try {
      ircReacter = await ircReacter;
      ircReactee = await ircReactee;
      ircChan    = await ircChan;
      if (!ircReacter || !ircReactee || !ircChan) {
        throw Error('Missing reaction info');
      }
    } catch (e) {
      this.logError(ircUser, util.inspect(e));
      return;
    }
    let message = this.meMessage('reacts @ ' + ircReactee + ': ' + event.reaction);
    this.ircd.write(ircUser.socket, ircReacter, 'PRIVMSG', [ ircChan, message ]);
  }
  onIrcMsg(ircUser, msg) {
    console.log('irc_msg', util.inspect(msg));
  }
  onIrcLine(ircUser, line) {
    console.log('irc_line', line);
  }
  onIrcError(ircUser, err) {
    console.log('irc_err', err);
  }
  onSlackEvent(ircUser, eventName, event) {
    console.log('slack_event', eventName, util.inspect(event));
  }
  async resolveSlackTarget(ircUser, event) {
    let ircNick = null;
    let ircChan = null;
    if (event.user)    ircNick = this.resolveSlackUser(ircUser, event.user);
    if (event.channel) ircChan = this.resolveSlackChannel(ircUser, event.channel);
    try {
      if (event.user)    ircNick = await ircNick;
      if (event.channel) ircChan = await ircChan;
    } catch (e) {
      this.logError(ircUser, util.inspect(e));
    }
    return [ ircNick, ircChan ];
  }
  async resolveSlackChannel(ircUser, slackChan) {
    // Check cache
    let ircChan = ircUser.slackToIrc.get(slackChan);
    if (ircChan) return ircChan;

    // Try conversations.info
    let convo;
    try {
      convo = await ircUser.slackWeb.apiCall('conversations.info', { channel: slackChan });
      if (!convo.ok) throw convo;
    } catch (e) {
      this.logError(ircUser, 'Failed conversations.info: ' + util.inspect(e));
      return null;
    }

    // If it's an im, pass to resolveSlackUser
    if (convo.channel.is_im) {
      return this.resolveSlackUser(ircUser, convo.channel.user);
    }

    // Set cache; return
    ircChan = '#' + convo.channel.name;
    ircUser.slackToIrc.set(slackChan, ircChan);
    ircUser.ircToSlack.set(ircChan, slackChan);
    return ircChan;
  }
  async resolveSlackUser(ircUser, slackUser) {
    // Check cache
    let ircNick = ircUser.slackToIrc.get(slackUser);
    if (ircNick) return ircNick;

    // Try users.info
    let user;
    try {
      user = await ircUser.slackWeb.apiCall('users.info', { user: slackUser });
      if (!user.ok) throw user;
    } catch (e) {
      this.logError(ircUser, 'Failed users.info: ' + util.inspect(e));
      return null;
    }

    // Set cache; return
    ircNick = user.user.name;
    ircUser.slackToIrc.set(slackUser, ircNick);
    ircUser.ircToSlack.set(ircNick, slackUser);
    return ircNick;
  }
  logError(ircUser, err) {
    console.log('slack_err', err);
  }
  meMessage(text) {
    return String.fromCharCode(1) + 'ACTION ' + text + String.fromCharCode(1);
  }
  async rememberSelfEcho(ircUser, message, apiCb) {
    console.log('rememberSelfEcho', message);
    await ircUser.selfEchoLock.acquireAsync();
    let chat = await apiCb();
    if (!chat.ok) throw chat;
    let maxSelfEchoEntries = 1024;
    ircUser.selfEchoList.unshift(this.selfEchoKeyFromEvent(chat, message));
    ircUser.selfEchoList = ircUser.selfEchoList.slice(0, maxSelfEchoEntries);
    ircUser.selfEchoLock.release();
  }
  async preventSelfEcho(ircUser, event, message) {
    console.log('preventSelfEcho', message);
    if (event.user !== ircUser.slackUserId) return false;
    await ircUser.selfEchoLock.acquireAsync();
    ircUser.selfEchoLock.release();
    let idx = ircUser.selfEchoList.indexOf(this.selfEchoKeyFromEvent(event, message));
    if (idx === -1) return false;
    ircUser.selfEchoList.splice(idx, 1);
    return true;
  }
  selfEchoKeyFromEvent(event, message) {
    let key = [];
    if (event.channel) key.push(event.channel);
    if (event.ts) key.push(event.ts);
    key.push(message);
    return key.join('|');
  }
  makeIrcHandler(method) {
    const self = this;
    return function() {
      const args = Array.from(arguments);
      const socket = args.shift();
      const ircUser = self.socketMap.get(socket);
      if (ircUser) {
        args.unshift(ircUser);
        method.apply(self, args);
      } else {
        self.onIrcError(null, 'Could not find user state for socket ' + socket);
      }
    };
  }
  makeSlackHandler(method) {
    const self = this;
    return function() {
      const args = Array.from(arguments);
      const rtm = this;
      const ircUser = self.rtmMap.get(rtm);
      if (ircUser) {
        args.unshift(ircUser);
        method.apply(self, args);
      } else {
        self.logError(null, 'Could not find user state for rtm ' + rtm);
      }
    };
  }
  async paginateCall(method, aggKey, options) {
    let results, result;
    options = options || {};
    while (1) {
      result = await this.apiCall(method, options);
      if (!results) {
        results = result;
      } else {
        results[aggKey] = results[aggKey].concat(result[aggKey]);
      }
      if (!result.response_metadata
         || !result.response_metadata.next_cursor
         || result.response_metadata.next_cursor.length < 1
      ) {
        break;
      }
      options.cursor = result.response_metadata.next_cursor;
    }
    return results;
  }
  async setSlackPresence(ircUser, active) {
      let status = (active) ? 'auto' : 'away';
      let presence;
      try {
          presence = await ircUser.slackWeb.apiCall('users.setPresence', { presence: status });
          if (!presence.ok) throw user;
      } catch (e) {
          this.logError(ircUser, 'Failed users.setPresence: ' + util.inspect(e));
      }
  }
}

class IrcUser {
  constructor(socket) {
    this.socket = socket;
    this.ircNick = 'user';
    this.slackToken = 'token';
    this.slackUserId = 'uid';
    this.slackWeb = null;
    this.slackRtm = null;
    this.inChannel = new Map();
    this.ircToSlack = new Map();
    this.slackToIrc = new Map();
    this.selfEchoList = [];
    this.selfEchoLock = new AwaitLock();
  }
}

exports.Irslackd = Irslackd;
