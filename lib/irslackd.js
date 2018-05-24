'use strict';

const util      = require('util');
const slack     = require('@slack/client');
const AwaitLock = require('await-lock');
const ircd      = require('./ircd');
const refresh   = require('./slack-refresh');

class Irslackd {
  constructor(config) {
    const self = this;
    self.socket = null;
    self.config = config;
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
      [ 'WHO',     self.makeIrcHandler(self.onIrcWho)     ],
      [ 'WHOIS',   self.makeIrcHandler(self.onIrcWhois)   ],
      [ 'line',    self.makeIrcHandler(self.onIrcLine)    ],
      [ 'error',   self.makeIrcHandler(self.onIrcError)   ],
      [ 'close',   self.makeIrcHandler(self.onIrcClose)   ],
      [ 'connect', (socket) => { self.onIrcConnect(socket); } ],
    ]).forEach((handler, cmd, map) => {
      self.ircd.on(cmd, handler);
    });
  }
  listen() {
    this.ircd.listen(this.config.port, this.config.host);
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
    ircUser.slackWeb.paginateCallOrThrow = self.paginateCallOrThrow;
    ircUser.slackWeb.apiCallOrThrow = self.apiCallOrThrow;
    ircUser.slackRtm = new slack.RTMClient(ircUser.slackToken);

    // Identify end-user
    let auth = await ircUser.slackWeb.apiCallOrThrow('auth.test');
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
      [ 'member_left_channel',   self.makeSlackHandler(self.onSlackMemberLeftChannel)   ],
      [ 'mpim_open',             self.makeSlackHandler(self.onSlackMpimOpen)            ],
      [ 'mpim_close',            self.makeSlackHandler(self.onSlackMpimClose)           ],
      [ 'reaction_added',        self.makeSlackHandler(self.onSlackReactionAdded)       ],
      [ 'user_typing',           self.makeSlackHandler(self.onSlackUserTyping)          ],
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
    if (msg.args.length === 0) {
      status = '';
      this.setSlackPresence(ircUser, true);
    } else {
      status = msg.args[0];
      // slack statuses are capped at 100 characters
      status = status.substring(0, 100);
      this.setSlackPresence(ircUser, false);
    }
    await ircUser.slackWeb.apiCallOrThrow('users.profile.set', {
      profile: {
        status_text: status,
        status_emoji: '',
      },
    });
  }
  async onIrcJoin(ircUser, msg, alreadyInSlackChanId) {
    let ircChan = msg.args[0];

    // Warn if IRC client is trying to join an `#mpdm*` channel
    // Probably an automated rejoin...
    if (!alreadyInSlackChanId && ircChan.substr(0, 5) === '#mpdm') {
      console.log('Refusing IRC mpdm join: ' + ircChan);
      return;
    }

    // Join Slack channel
    let convo;
    let alreadyInSlackChan;
    let slackChanId;
    if (!alreadyInSlackChanId) {
      let slackChanName = ircChan;
      if (slackChanName.substr(0, 1) === '#') slackChanName = slackChanName.substr(1);
      convo = await ircUser.slackWeb.apiCallOrThrow('channels.join', { name: slackChanName });
      alreadyInSlackChan = convo.already_in_channel;
      slackChanId = convo.channel.id;
    } else {
      alreadyInSlackChan = true;
      slackChanId = alreadyInSlackChanId;
    }

    // Bail if already in channel on Slack and IRC
    if (alreadyInSlackChan && ircUser.inChannel.get(ircChan)) {
      return;
    }

    // Call conversations.info
    // (channels.join returns limited channel info if already in channel case)
    convo = await ircUser.slackWeb.apiCallOrThrow('conversations.info', { channel: slackChanId });

    // Update maps
    ircUser.ircToSlack.set(ircChan, convo.channel.id);
    ircUser.slackToIrc.set(convo.channel.id, ircChan);

    // Get Slack channel members
    let members = await ircUser.slackWeb.paginateCallOrThrow('conversations.members', 'members', { channel: convo.channel.id });

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
      convo.channel.topic.value = this.decodeEntities(convo.channel.topic.value);
      this.ircd.write(ircUser.socket, 'irslackd', '332', [ '=', ircChan, ':' + convo.channel.topic.value ]);
    }
    this.ircd.write(ircUser.socket, 'irslackd', '353', [ '=', ircChan, ircNicks.join(' ') ]);
  }
  async onIrcPart(ircUser, msg, alreadyInSlackChanId) {
    let ircChan = msg.args[0];

    let slackChan;
    if (!alreadyInSlackChanId) {
      // Bail if Slack channel not in map
      slackChan = ircUser.ircToSlack.get(ircChan);
      if (!slackChan) {
        this.logError(ircUser, 'No entry in ircToSlack for channel ' + ircChan);
        return;
      }
    } else {
      slackChan = alreadyInSlackChanId;
    }

    // Leave Slack channel
    let apiMethod = slackChan.substr(0, 1) === 'G' ? 'mpim.close' : 'conversations.leave';
    await ircUser.slackWeb.apiCallOrThrow(apiMethod, { channel: slackChan });

    // Unset inChannel marker and leave IRC channel
    if (ircUser.inChannel.delete(ircChan)) {
      this.ircd.write(ircUser.socket, ircUser.ircNick, 'PART', [ ircChan ]);
    }
  }
  async onIrcPrivmsg(ircUser, msg) {
    let target = msg.args[0];
    let message = msg.args[1];

    // Slackize
    message = this.slackizeText(ircUser, message);

    // Extract @thread-<thread_ts> prefix
    let thread_ts;
    [message, thread_ts] = this.extractThread(message);

    // Resolve target as Slack channel
    let slackChan;
    let slackTarget = ircUser.ircToSlack.get(target);
    if (!slackTarget) throw Error('No entry in ircToSlack for target ' + target);
    if (target.substr(0, 1) === '#') {
      slackChan = slackTarget;
    } else {
      let im = await ircUser.slackWeb.apiCallOrThrow('im.open', { user: slackTarget });
      slackChan = im.channel.id;
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
    await this.rememberSelfEcho(ircUser, message, () => {
      return ircUser.slackWeb.apiCallOrThrow(apiMethod, {
        channel: slackChan,
        text: message,
        as_user: true,
        thread_ts: thread_ts,
      });
    });
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
    // Await on usernames and teams as they are needed before populating channels
    try {
      await refresh.refreshUsers.call(this, ircUser);
      await refresh.refreshTeams.call(this, ircUser); // TODO subteam_created
      refresh.refreshChannels.call(this, ircUser);
    } catch (e) {
      this.logError(ircUser, e);
    }
  }
  async onSlackMessage(ircUser, event) {
    const self = this;

    // Delegate certain events
    if (event.subtype === 'channel_join') {
      return this.onSlackMemberJoinedChannel(ircUser, event);
    } else if (event.subtype === 'channel_leave') {
      return this.onSlackMemberLeftChannel(ircUser, event);
    } else if (event.subtype === 'channel_topic' || event.subtype === 'group_topic') {
      return this.onSlackTopicChange(ircUser, event);
    }

    // Make bot messages appear as normal
    if (event.subtype === 'bot_message' && event.attachments && event.attachments.length > 0) {
      event.text = event.attachments[0].text;
    }

    // Ignore message_changed events if text did not change
    if (event.subtype === 'message_changed' && event.message.text === event.previous_message.text) {
      return;
    }

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

    // Bail if no message text
    if (typeof event.text !== 'string') {
      if (event.subtype !== 'message_replied') {
        // Not sure where this might happen
        this.logError(ircUser, 'onSlackMessage with no event.text; event: ' + util.inspect(event));
      }
      return;
    }

    // Decode text
    event.text = this.decodeEntities(event.text);

    // Ircize text
    event.text = this.ircizeText(ircUser, event.text);

    // Prevent self-echo
    if (await this.preventSelfEcho(ircUser, event, event.text)) return;

    // Get nick and channel
    let [ircNick, ircTarget] = await this.resolveSlackTarget(ircUser, event);
    if (!ircNick || !ircTarget) {
      this.logError(ircUser, 'Failed this.resolveSlackTarget; event: ' + util.inspect(event));
      return;
    }

    // If not already in channel, join it
    if (ircTarget.substr(0, 1) === '#' && !ircUser.inChannel.get(ircTarget)) {
      try {
        await this.onIrcJoin(ircUser, { args: [ ircTarget ] }, event.channel);
      } catch (e) {
        this.logError(ircUser, 'Failed onIrcJoin: ' + util.inspect(e));
        return;
      }
    }

    // Prepend thread_ts to message if it exists
    if (event.thread_ts) {
      event.text = '@thread-' + event.thread_ts + ' ' + event.text;
    }

    // Also send attachments
    let messages = [ event.text ];
    if (event.attachments) {
      event.attachments.forEach(function(attachment, idx) {
        if (attachment.fallback) messages.push(self.ircizeText(ircUser, self.decodeEntities(attachment.fallback)));
        if (attachment.from_url) messages.push(attachment.from_url);
      });
    }

    // Send to IRC, once for each newline
    messages.forEach(function(message, idx) {
      message.split(/(\r\n|\r|\n)/).forEach(function(line, idx) {
        line = line.trim();
        if (line.length < 1) return;
        if (event.subtype === 'me_message') line = self.meText(line);
        self.ircd.write(ircUser.socket, ircNick, 'PRIVMSG', [ ircTarget, ':' + line ]);
      });
    });
  }
  async onSlackTopicChange(ircUser, event) {
    // Get nick and channel
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (!ircNick || !ircChan) return;

    // Decode entities, ircize text
    event.topic = this.ircizeText(ircUser, this.decodeEntities(event.topic));

    // Send topic message
    this.ircd.write(ircUser.socket, ircNick, 'TOPIC', [ ircChan, event.topic ]);
  }
  async onSlackChannelJoined(ircUser, event) {
    let ircChan = await this.resolveSlackChannel(ircUser, event.channel);
    if (ircChan) {
      this.onIrcJoin(ircUser, { args: [ ircChan ] }, event.channel);
    }
  }
  async onSlackChannelLeft(ircUser, event) {
    let ircChan = await this.resolveSlackChannel(ircUser, event.channel);
    if (ircChan) {
      this.onIrcPart(ircUser, { args: [ ircChan ] }, event.channel);
    }
  }
  async onSlackMemberJoinedChannel(ircUser, event) {
    if (event.user === ircUser.slackUserId) return;
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (ircNick && ircChan) {
      this.ircd.write(ircUser.socket, ircNick, 'JOIN', [ ircChan ]);
    }
  }
  async onSlackMemberLeftChannel(ircUser, event) {
    if (event.user === ircUser.slackUserId) return;
    let [ircNick, ircChan] = await this.resolveSlackTarget(ircUser, event);
    if (ircNick && ircChan) {
      this.ircd.write(ircUser.socket, ircNick, 'PART', [ ircChan ]);
    }
  }
  async onSlackMpimOpen(ircUser, event) {
    this.onSlackChannelJoined(ircUser, event);
  }
  async onSlackMpimClose(ircUser, event) {
    this.onSlackChannelLeft(ircUser, event);
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
    let message = this.meText('reacts @ ' + ircReactee + ': ' + event.reaction);
    this.ircd.write(ircUser.socket, ircReacter, 'PRIVMSG', [ ircChan, message ]);
  }
  async onSlackUserTyping(ircUser, event) {
    /*
    let self = this;
    let ircNick = this.resolveSlackUser(ircUser, event.user);
    let ircChan = this.resolveSlackChannel(ircUser, event.channel);
    ircNick = await ircNick;
    ircChan = await ircChan;
    if (!ircNick || !ircChan || ircChan.substr(0, 1) !== '#') return;
    if (ircUser.typingTimer) return;
    this.ircd.write(ircUser.socket, 'irslackd', 'MODE', [ ircChan, '+v', ircNick ]);
    ircUser.typingTimer = setTimeout(function() {
      self.ircd.write(ircUser.socket, 'irslackd', 'MODE', [ ircChan, '-v', ircNick ]);
      ircUser.typingTimer = null;
    }, 5000);
    */
  }
  async onIrcWho(ircUser, msg) {
    await this.onIrcWhois(ircUser, msg);
  }
  async onIrcWhois(ircUser, msg) {
    if (msg.args.length < 1) return;
    let ircNick = msg.args[0];
    let slackUser = ircUser.ircToSlack.get(ircNick);
    if (!slackUser) return;
    let user = await ircUser.slackWeb.apiCallOrThrow('users.info', { user: slackUser });
    this.ircd.write(ircUser.socket, 'irslackd', '311', [
      '=',
      ircNick,
      user.user.name,
      'irslackd',
      '*',
      ':' + user.user.real_name,
    ]);
    this.ircd.write(ircUser.socket, 'irslackd', '318', [ '=', ircNick, ':End of WHOIS list' ]);
  }
  onIrcLine(ircUser, line) {
    console.log('irc_in', line);
  }
  onIrcError(ircUser, err) {
    console.log('irc_err', err);
  }
  onSlackEvent(ircUser, eventName, event) {
    console.log('slack_in', eventName, util.inspect(event));
  }
  async resolveSlackTarget(ircUser, event) {
    let ircNick = null;
    let ircChan = null;
    if (event.user)        ircNick = this.resolveSlackUser(ircUser, event.user);
    else if (event.bot_id) ircNick = this.resolveSlackBot(ircUser, event.bot_id);
    if (event.channel)     ircChan = this.resolveSlackChannel(ircUser, event.channel);
    try {
      if (ircNick) ircNick = await ircNick;
      if (ircChan) ircChan = await ircChan;
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
    let convo = await ircUser.slackWeb.apiCallOrThrow('conversations.info', { channel: slackChan });

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
    let user = await ircUser.slackWeb.apiCallOrThrow('users.info', { user: slackUser });

    // Set cache; return
    ircNick = user.user.name;
    ircUser.slackToIrc.set(slackUser, ircNick);
    ircUser.ircToSlack.set(ircNick, slackUser);
    return ircNick;
  }
  async resolveSlackBot(ircUser, slackBotId) {
    // Check cache
    let ircNick = ircUser.slackToIrc.get(slackBotId);
    if (ircNick) return ircNick;

    // Try bots.info
    let bot = await ircUser.slackWeb.apiCallOrThrow('bots.info', { bot: slackBotId });

    // Set cache; return
    ircNick = bot.bot.name;
    ircUser.slackToIrc.set(slackBotId, ircNick);
    ircUser.ircToSlack.set(ircNick, slackBotId);
    return ircNick;
  }
  logError(ircUser, err) {
    console.trace('irslackd_err', err);
  }
  meText(text) {
    return String.fromCharCode(1) + 'ACTION ' + text + String.fromCharCode(1);
  }
  decodeEntities(text) {
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    return text;
  }
  ircizeText(ircUser, text) {
    // TODO Be more efficient
    if (text.indexOf('<') === -1) return text;
    return this.applyReplacements(ircUser.translateSlackToIrc, text);
  }
  slackizeText(ircUser, text) {
    // TODO Be more efficient
    if (text.indexOf('@') === -1 && text.indexOf('#') === -1) return text;
    return this.applyReplacements(ircUser.translateIrcToSlack, text);
  }
  extractThread(text) {
    let re = /^@thread-([^ ]+) /;
    let match = re.exec(text);
    if (match) {
      return [ text.replace(re, ''), match[1] ];
    }
    return [ text, null ];
  }
  applyReplacements(replMap, text) {
    replMap.forEach((repl, needle, m) => {
      text = text.replace(needle, function(match, offset, str) {
        let rightOffset = offset + match.length;
        let padLeft  = (offset <= 0                   || /[^\w-]/.test(str[offset - 1]));
        let padRight = (rightOffset >= str.length - 1 || /[^\w-]/.test(str[rightOffset]));
        return padLeft && padRight ? repl : match;
      });
    });
    return text;
  }
  async rememberSelfEcho(ircUser, message, apiCb) {
    await ircUser.selfEchoLock.acquireAsync();
    let chat = await apiCb();
    let maxSelfEchoEntries = 1024;
    ircUser.selfEchoList.unshift(this.selfEchoKeyFromEvent(chat, message));
    ircUser.selfEchoList = ircUser.selfEchoList.slice(0, maxSelfEchoEntries);
    ircUser.selfEchoLock.release();
  }
  async preventSelfEcho(ircUser, event, message) {
    let shouldSkipMessage = false;
    if (event.user !== ircUser.slackUserId) {
      return shouldSkipMessage;
    }
    await ircUser.selfEchoLock.acquireAsync();
    let idx = ircUser.selfEchoList.indexOf(this.selfEchoKeyFromEvent(event, message));
    if (idx >= 0) {
      ircUser.selfEchoList.splice(idx, 1);
      shouldSkipMessage = true;
    }
    ircUser.selfEchoLock.release();
    return shouldSkipMessage;
  }
  selfEchoKeyFromEvent(event, message) {
    let key = [];
    if (event.channel) key.push(event.channel);
    if (event.ts) key.push(event.ts);
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
        let res = method.apply(self, args);
        if (typeof res === 'object' && typeof res.catch === 'function') {
          res.catch(function(e) {
            self.logError(ircUser, 'Failed ' + method.name + ': ' + util.inspect(e));
          });
        }
      } else {
        self.logError(null, 'Could not find user state for socket ' + socket);
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
        let res = method.apply(self, args);
        if (typeof res === 'object' && typeof res.catch === 'function') {
          res.catch(function(e) {
            self.logError(ircUser, 'Failed ' + method.name + ': ' + util.inspect(e));
          });
        }
      } else {
        self.logError(null, 'Could not find user state for rtm ' + rtm);
      }
    };
  }
  async apiCallOrThrow(method, options) {
    console.log('slack_out', method, util.inspect(options));
    let result = await this.apiCall(method, options);
    if (!result.ok) {
      throw result;
    }
    return result;
  }
  async paginateCallOrThrow(method, aggKey, options) {
    let results, result;
    options = options || {};
    while (1) {
      result = await this.apiCallOrThrow(method, options);
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
    await ircUser.slackWeb.apiCallOrThrow('users.setPresence', { presence: status });
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
    this.ircToSlack = new Map(); // TODO Rename these maps
    this.slackToIrc = new Map();
    this.translateIrcToSlack = new Map();
    this.translateSlackToIrc = new Map();
    this.selfEchoList = [];
    this.selfEchoLock = new AwaitLock();
    this.typingTimer = null;
  }
}

exports.Irslackd = Irslackd;
