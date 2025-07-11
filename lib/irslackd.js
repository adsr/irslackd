'use strict';

const util      = require('util');
const AwaitLock = require('await-lock');
const ircd      = require('./ircd');
const slackInit = require('./slack-init');
const debugChannel = '&irslackd';

const { WebClient } = require('@slack/web-api');
const { RTMClient } = require('@slack/rtm-api');
const slack = { WebClient: WebClient, RTMClient: RTMClient };

class Irslackd {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.ircd = null;
    this.rtmMap = new Map();
    this.socketMap = new Map();
  }
  listen() {
    const self = this;
    self.ircd = self.getNewIrcd(self.config);
    const requireInit = true;
    const noRequireInit = false;
    new Map([
      [ 'AWAY',     self.makeIrcHandler(self.onIrcAway,    requireInit)   ],
      [ 'INVITE',   self.makeIrcHandler(self.onIrcInvite,  requireInit)   ],
      [ 'JOIN',     self.makeIrcHandler(self.onIrcJoin,    requireInit)   ],
      [ 'KICK',     self.makeIrcHandler(self.onIrcKick,    requireInit)   ],
      [ 'LIST',     self.makeIrcHandler(self.onIrcList,    requireInit)   ],
      [ 'MODE',     self.makeIrcHandler(self.onIrcMode,    noRequireInit) ],
      [ 'NICK',     self.makeIrcHandler(self.onIrcNick,    noRequireInit) ],
      [ 'PART',     self.makeIrcHandler(self.onIrcPart,    requireInit)   ],
      [ 'PASS',     self.makeIrcHandler(self.onIrcPass,    noRequireInit) ],
      [ 'PING',     self.makeIrcHandler(self.onIrcPing,    noRequireInit) ],
      [ 'PRIVMSG',  self.makeIrcHandler(self.onIrcPrivmsg, requireInit)   ],
      [ 'QUIT',     self.makeIrcHandler(self.onIrcQuit,    requireInit)   ],
      [ 'TOPIC',    self.makeIrcHandler(self.onIrcTopic,   requireInit)   ],
      [ 'USER',     self.makeIrcHandler(self.onIrcUser,    noRequireInit) ],
      [ 'WHOIS',    self.makeIrcHandler(self.onIrcWhois,   requireInit)   ],
      [ 'WHO',      self.makeIrcHandler(self.onIrcWho,     requireInit)   ],
      [ 'ircLine',  self.makeIrcHandler(self.onIrcLine,    noRequireInit) ],
      [ 'ircError', self.makeIrcHandler(self.onIrcError,   noRequireInit) ],
      [ 'ircClose', self.makeIrcHandler(self.onIrcClose,   noRequireInit) ],
      [ 'ircConnect', (socket) => { self.onIrcConnect(socket); } ],
    ]).forEach((handler, cmd, map) => {
      self.ircd.on(cmd, handler);
    });
    self.ircd.listen(self.config.port, self.config.host);
  }
  async onIrcConnect(socket) {
    this.socketMap.set(socket, new IrcUser(socket, this.ircd));
  }
  async onIrcClose(ircUser, hadError) {
    console.log('irc_out', 'Disconnecting client');
    try {
      if (ircUser.socket) {
        ircUser.socket.destroy();
        this.socketMap.delete(ircUser.socket);
      }
      if (ircUser.slackRtm) {
        ircUser.slackRtm.disconnect();
        this.rtmMap.delete(ircUser.slackRtm);
      }
      if (ircUser.slackWeb) {
        await this.setSlackPresence(ircUser, false);
      }
    } catch (e) {
      ircUser.logError('Caught exception at disconnect: ' + util.inspect(e));
    }
  }
  async onIrcPass(ircUser, msg) {
    let allArgs = msg.args.join(' ').split(' ');
    const tokenAndMaybeCookie = allArgs.shift();
    const [token, cookie] = Irslackd.parseSlackToken(tokenAndMaybeCookie);
    ircUser.slackToken = token;
    ircUser.slackCookie = cookie;
    ircUser.preferences = allArgs;
  }
  static parseSlackToken(tokenAndMaybeCookieStr) {
    const tokenAndMaybeCookie = tokenAndMaybeCookieStr.split('|', 2);
    const token = tokenAndMaybeCookie[0];
    let cookie = null;
    if (tokenAndMaybeCookie.length >= 2) {
      if (tokenAndMaybeCookie[1].length > 0) {
        cookie = Buffer.from(tokenAndMaybeCookie[1], 'base64').toString('ascii');
        if (cookie.length < 1) {
          cookie = null;
        }
      }
    }
    return [ token, cookie ];
  }
  async onIrcNick(ircUser, msg) {
    if (!ircUser.ircNickLocked) {
      ircUser.ircNick = msg.args[0] || 'user';
    } else {
      this.ircd.write(ircUser.socket, 'irslackd', '484', [
        ircUser.ircNick,
        ':Your connection is restricted!',
      ]);
    }
  }
  async onIrcUser(ircUser, msg) {
    const self = this;
    ircUser.slackWeb = self.getNewSlackWebClient(ircUser.slackToken, ircUser.slackCookie);
    ircUser.slackWeb.paginateCallOrThrow = self.paginateCallOrThrow;
    ircUser.slackWeb.apiCallOrThrow = self.apiCallOrThrow;
    ircUser.slackWeb.irslackd = self;
    ircUser.slackWeb.ircUser = ircUser;
    ircUser.slackRtm = self.getNewSlackRtmClient(ircUser.slackToken, ircUser.slackCookie);

    // Identify end-user
    const auth = await ircUser.slackWeb.apiCallOrThrow('auth.test');
    ircUser.slackUserId = auth.user_id;
    ircUser.slackUserIds.add(auth.user_id);

    // Lock IRC nick
    let origNick = ircUser.ircNick;
    ircUser.ircNick = (await ircUser.resolveSlackUser(ircUser.slackUserId)) || ircUser.ircNick;
    if (origNick !== ircUser.ircNick) {
      this.ircd.write(ircUser.socket, origNick, 'NICK', [ ircUser.ircNick ]);
    }
    ircUser.ircNickLocked = true;

    // Setup Slack handlers
    self.rtmMap.set(ircUser.slackRtm, ircUser);
    new Map([
      [ 'ready',                 self.makeSlackHandler(self.onSlackReady)               ],
      [ 'message',               self.makeSlackHandler(self.onSlackMessage)             ],
      [ 'channel_joined',        self.makeSlackHandler(self.onSlackChannelJoined)       ],
      [ 'channel_left',          self.makeSlackHandler(self.onSlackChannelLeft)         ],
      [ 'channel_rename',        self.makeSlackHandler(self.onSlackChannelRename)       ],
      [ 'group_rename',          self.makeSlackHandler(self.onSlackChannelRename)       ],
      [ 'group_left',            self.makeSlackHandler(self.onSlackChannelLeft)         ],
      [ 'channel_created',       self.makeSlackHandler(self.onSlackChannelCreated)      ],
      [ 'channel_archive',       self.makeSlackHandler(self.onSlackChannelArchive)      ],
      [ 'member_joined_channel', self.makeSlackHandler(self.onSlackMemberJoinedChannel) ],
      [ 'member_left_channel',   self.makeSlackHandler(self.onSlackMemberLeftChannel)   ],
      [ 'mpim_open',             self.makeSlackHandler(self.onSlackMpimOpen)            ],
      [ 'mpim_close',            self.makeSlackHandler(self.onSlackMpimClose)           ],
      [ 'reaction_added',        self.makeSlackHandler(self.onSlackReactionAdded)       ],
      [ 'reaction_removed',      self.makeSlackHandler(self.onSlackReactionRemoved)     ],
      [ 'subteam_created',       self.makeSlackHandler(self.onSlackSubteamUpdated)      ],
      [ 'subteam_updated',       self.makeSlackHandler(self.onSlackSubteamUpdated)      ],
      [ 'subteam_self_added',    self.makeSlackHandler(self.onSlackSubteamSelfAdded)    ],
      [ 'subteam_self_removed',  self.makeSlackHandler(self.onSlackSubteamSelfRemoved)  ],
      [ 'user_typing',           self.makeSlackHandler(self.onSlackUserTyping)          ],
      [ 'presence_change',       self.makeSlackHandler(self.onSlackPresenceChange)      ],
      [ 'team_join',             self.makeSlackHandler(self.onSlackTeamJoin)            ],
      [ 'slack_event',           self.makeSlackHandler(self.onSlackEvent)               ],
    ]).forEach((handler, event, map) => {
      ircUser.slackRtm.on(event, handler);
    });

    // Wait for initialization
    await self.initialize(ircUser);

    // Start RTM
    ircUser.slackRtm.start({
      batch_presence_aware: ircUser.presenceEnabled(),
    });
    self.updatePresenceSubscriptions(ircUser);
  }

  async onIrcAway(ircUser, msg) {
    let status = '';
    let emoji = '';
    if (msg.args.length === 0) {
      // if args is empty, unset away status
      this.setSlackPresence(ircUser, true);
    } else {
      // pick off emoji
      let emoji_status = /^(:\w+:)?(.*)$/.exec(msg.args[0]);
      emoji = emoji_status[1] || '';
      // slack statuses are capped at 100 characters
      status = emoji_status[2].substring(0, 100);
      this.setSlackPresence(ircUser, false);
    }
    await ircUser.slackWeb.apiCallOrThrow('users.profile.set', {
      profile: {
        status_text: status,
        status_emoji: emoji,
      },
    });
  }
  async onIrcJoin(ircUser, msg) {
    const self = this;
    let ircChans = msg.args[0].split(',');
    let joinPromises = [];
    for (let ircChan of ircChans) {
      if (!ircUser.isInChannel(ircChan)) {
        joinPromises.push(self.onIrcJoinOne(ircUser, ircChan, false));
      }
    }
    await Promise.all(joinPromises);
  }
  async onIrcJoinOne(ircUser, ircChan, alreadyInSlackChanId) {
    // Normalize ircChan
    ircChan = ircUser.normalizeIrcChan(ircChan);

    // Warn if IRC client is trying to join an `#mpdm*` channel
    // Probably an automated rejoin...
    if (!alreadyInSlackChanId && this.isMpdmChannel(ircChan)) {
      console.log('Refusing IRC mpdm join: ' + ircChan);
      return;
    }

    // Handle special debug channel
    if (this.isDebugChannel(ircChan)) {
      this.onIrcDebugJoin(ircUser);
      return;
    }

    // Join Slack channel
    let convo;
    let alreadyInSlackChan;
    let slackChanId;
    if (!alreadyInSlackChanId) {
      // Resolve Slack channel from IRC channel name
      try {
        slackChanId = ircUser.resolveIrcChannel(ircChan);
      } catch (e) {
        // Hi mom
      }
      if (slackChanId) {
        // Slack channel already exists
        convo = await ircUser.slackWeb.apiCallOrThrow('conversations.join', {
          channel: slackChanId,
        });
        alreadyInSlackChan = convo.already_in_channel || convo.warning === 'already_in_channel';
      } else {
        // Slack channel does not exist
        convo = await ircUser.slackWeb.apiCallOrThrow('conversations.create', {
          name: ircChan.substr(1), // #blah -> blah
          is_private: false,
        });
        alreadyInSlackChan = false;
      }
    } else {
      // Already in Slack channel
      slackChanId = alreadyInSlackChanId;
      alreadyInSlackChan = true;
      // Still need to call conversations.info for topic
      convo = await ircUser.slackWeb.apiCallOrThrow('conversations.info', {
        channel: slackChanId,
      });
    }

    // Bail if already in channel on Slack and IRC
    if (alreadyInSlackChan && ircUser.isInChannel(ircChan)) {
      return;
    }

    // Update maps
    ircUser.mapIrcToSlack(ircChan, convo.channel.id);

    // Get Slack channel members
    let members = await ircUser.slackWeb.paginateCallOrThrow('conversations.members', 'members', {
      channel: convo.channel.id,
      limit: 1000,
    });

    // Assemble IRC nicks
    let ircNicks = [ ircUser.ircNick ];
    let ircNickPromises = [];
    members.members.forEach((userId) => {
      let ircNickPromise = ircUser.resolveSlackUser(userId);
      ircNickPromise.userId = userId;
      ircNickPromises.push(ircNickPromise);
    });
    for (let ircNickPromise of ircNickPromises) {
      try {
        ircNicks.push(await ircNickPromise);
      } catch (e) {
        ircUser.logError('No user for userId ' + ircNickPromise.userId);
      }
    }

    // Join channel
    this.sendIrcChannelJoin(ircUser, ircChan, convo.channel.topic.value, ircNicks);
  }
  async onIrcPart(ircUser, msg, alreadyInSlackChanId) {
    let ircChan = msg.args[0];

    // Handle special debug channel
    if (this.isDebugChannel(ircChan)) {
      this.onIrcDebugPart(ircUser);
      return;
    }

    let slackChan;
    if (!alreadyInSlackChanId) {
      // Bail if Slack channel not in map
      slackChan = ircUser.resolveIrcChannel(ircChan);
    } else {
      slackChan = alreadyInSlackChanId;
    }

    // Leave Slack channel
    let apiMethod = this.isMpdmChannel(ircChan) ? 'conversations.close' : 'conversations.leave';
    await ircUser.slackWeb.apiCallOrThrow(apiMethod, { channel: slackChan });

    // Unset channel marker and leave IRC channel
    this.sendIrcChannelPart(ircUser, ircChan);
  }
  async onIrcPrivmsg(ircUser, msg) {
    let target = msg.args[0];
    let message = msg.args[1];

    // Handle special debug channel
    if (this.isDebugChannel(target)) {
      msg.args.shift();
      return this.onIrcDebugPrivmsg(ircUser, msg);
    }

    // Handle @slack commands
    if (message.substr(0, 7) === '@slack ') {
      msg.args[1] = msg.args[1].substr(7);
      return await this.onIrcAtSlackPrivmsg(ircUser, msg);
    }

    // Extract @thread-<thread_ts> prefix
    let thread_ts;
    [message, thread_ts] = this.extractThread(message);

    // Slackize
    message = this.slackizeText(ircUser, message);

    // Resolve target as Slack channel
    let slackChan;
    let slackTarget;
    if (this.isChannel(target)) {
      // Sending to a channel, update map
      slackTarget = ircUser.resolveIrcChannel(target);
      slackChan = slackTarget;
      ircUser.mapIrcToSlack(target, slackChan);
    } else {
      // Sending to a user, update nick-channel map
      slackTarget = ircUser.resolveIrcUser(target);
      slackChan = ircUser.ircNickToSlackChanId.get(target);
      if (!slackChan) {
        let im = await ircUser.slackWeb.apiCallOrThrow('conversations.open', {
          users: slackTarget,
        });
        slackChan = im.channel.id;
        ircUser.ircNickToSlackChanId.set(target, slackChan);
      }
    }

    // Check for /me message
    let apiMethod = 'chat.postMessage';
    if (this.isCtcpCommand('ACTION', message)) {
      apiMethod = 'chat.meMessage';
      message = message.substr(8);
      if (message.charCodeAt(message.length - 1) === 1) {
        message = message.substr(0, message.length - 1);
      }
    }

    // Check for CTCP TYPING message
    if (ircUser.typingNotificationsEnabled() && this.isCtcpCommand('TYPING', message)) {
      return await ircUser.slackRtm.sendTyping(slackChan);
    }

    // Call chat.(post|me)Message
    await this.rememberSelfEcho(ircUser, message, async() => {
      return await ircUser.slackWeb.apiCallOrThrow(apiMethod, {
        channel: slackChan,
        text: message,
        as_user: true,
        thread_ts: thread_ts,
      });
    });
  }
  async onIrcPing(ircUser, msg) {
    // Send PONG
    this.ircd.write(ircUser.socket, 'irslackd', 'PONG', [ 'irslackd' ]);
  }
  async onIrcMode(ircUser, msg) {
    let target = msg.args[0];
    if (this.isChannel(target)) {
      // if its just the channel
      if (msg.args.length === 1) {
        // then make sure it has an empty mode string
        msg.args.push('+');
      }
      this.ircd.write(ircUser.socket, 'irslackd', 'MODE', msg.args);
    }
  }
  async onIrcInvite(ircUser, msg) {
    const ircNick = msg.args[0];
    const ircChan = msg.args[1];
    let slackChan, slackUser;

    try {
      slackUser = ircUser.resolveIrcUser(ircNick);
      slackChan = ircUser.resolveIrcChannel(ircChan);
    } catch (e) {
      ircUser.logError('Cannot determine target for INVITE; saw ' + util.inspect(msg.args));
      return;
    }

    await ircUser.slackWeb.apiCallOrThrow('conversations.invite', {
      users: slackUser,
      channel: slackChan,
    });

    this.ircd.write(ircUser.socket, 'irslackd', '341', [
      ircUser.ircNick,
      ircNick,
      ircChan,
    ]);
  }
  async onIrcTopic(ircUser, msg) {
    const ircChan = msg.args[0];
    let ircTopic = msg.args[1];

    let slackChan;
    try {
      slackChan = ircUser.resolveIrcChannel(ircChan);
    } catch (e) {
      ircUser.logError('Cannot determine target for TOPIC; saw ' + util.inspect(msg.args));
      return;
    }

    let res;
    if (ircTopic) {
      // Set topic
      res = await ircUser.slackWeb.apiCallOrThrow('conversations.setTopic', {
        channel: slackChan,
        topic: ircTopic,
      });
      ircTopic = res.topic;
    } else {
      // Get topic
      res = await ircUser.slackWeb.apiCallOrThrow('conversations.info', {
        channel: slackChan,
      });
    }
    ircTopic = this.ircizeText(ircUser, res.channel.topic.value);

    this.ircd.write(ircUser.socket, 'irslackd', '332', [
      ircUser.ircNick,
      ircChan,
      ':' + ircTopic,
    ]);
  }
  async onIrcKick(ircUser, msg) {
    const ircChan = msg.args[0];
    const ircNick = msg.args[1];

    let slackChan, slackUser;
    try {
      slackChan = ircUser.resolveIrcChannel(ircChan);
      slackUser = ircUser.resolveIrcUser(ircNick);
    } catch (e) {
      ircUser.logError('Cannot determine target for KICK; saw ' + util.inspect(msg.args));
      return;
    }

    await ircUser.slackWeb.apiCallOrThrow('conversations.kick', {
      channel: slackChan,
      user: slackUser,
    });

    this.ircd.write(ircUser.socket, ircUser.ircNick, 'KICK', msg.args);
  }
  async onIrcList(ircUser, msg) {
    const self = this;
    if (msg.args.length > 0) return; // Only support `LIST` with no params
    let convos = await ircUser.slackWeb.paginateCallOrThrow('conversations.list', 'channels', {
      exclude_archived: true,
      types: 'public_channel',
      limit: 1000,
    });
    convos.channels.forEach((channel) => {
      let ircChan = ircUser.getIrcChannelName(channel.name);

      self.ircd.write(ircUser.socket, 'irslackd', '322', [
        ircUser.ircNick,
        ircChan,
        channel.num_members,
        ':' + channel.topic.value,
      ]);
    });
    self.ircd.write(ircUser.socket, 'irslackd', '323', [ ircUser.ircNick, ':End of LIST' ]);
  }
  async onIrcQuit(ircUser, msg) {
    // Close link
    this.ircd.write(ircUser.socket, 'irslackd', 'ERROR', [ ':Closing Link' ]);
    ircUser.socket.destroy();
  }
  async initialize(ircUser) {
    // Initialize Slack users and channels in an efficient, batch way
    // Await on usernames and teams as they are needed before populating channels
    try {
      await slackInit.initUsers.call(this, ircUser);
      await slackInit.initTeams.call(this, ircUser);
      await slackInit.initChannels.call(this, ircUser);
      if (ircUser.debugChannelEnabled()) this.onIrcDebugJoin(ircUser);
    } catch (e) {
      ircUser.logError('Failed to initialize workspace:' + util.inspect(e));
    } finally {
      ircUser.setInitialized();
      // ircUser.startIdResolver();
      console.log('slack_out: initialized');
    }
  }
  async onSlackReady(ircUser, event) {
    // RPL_WELCOME
    this.ircd.write(ircUser.socket, 'irslackd', '001', [ ircUser.ircNick, 'irslackd' ]);

    // RPL_ISUPPORT
    this.ircd.write(ircUser.socket, 'irslackd', '005', [ ircUser.ircNick, 'LINELEN=' + this.config.lineLen, 'are supported by this server' ]);

    // RPL_ENDOFMOTD
    this.ircd.write(ircUser.socket, 'irslackd', '376', [ ircUser.ircNick, 'End of MOTD' ]);

    // set user presence to auto instead of away
    await this.setSlackPresence(ircUser, true);
  }
  async onSlackMessage(ircUser, event) {
    const self = this;

    // Delegate certain events
    if (event.subtype === 'channel_join') {
      return await this.onSlackMemberJoinedChannel(ircUser, event);
    } else if (event.subtype === 'channel_leave') {
      return await this.onSlackMemberLeftChannel(ircUser, event);
    } else if (event.subtype === 'channel_topic' || event.subtype === 'group_topic') {
      return await this.onSlackTopicChange(ircUser, event);
    } else if (event.subtype === 'message_replied' && !event.text) {
      return;
    }

    // If this is a message in a thread and they are not enabled, bail
    if (event.thread_ts && !ircUser.threadsEnabled()) {
      return;
    }

    // Fix user field in file_comment
    if (event.subtype === 'file_comment') {
      event.user = event.comment.user;
    }

    // Make certain messages appear as `/me` actions
    if (event.subtype === 'message_changed') {
      if (event.previous_message && event.message.text === event.previous_message.text) {
        return; // Ignore message_changed events if text did not change
      }
      event.user = event.message.user;
      event.text = 'edits: ' + event.message.text;
      event.subtype = 'me_message';
    } else if (event.subtype === 'message_deleted') {
      if (event.previous_message) {
        event.text = 'deletes: ' + event.previous_message.text;
        event.user = event.previous_message.user;
        event.files = event.previous_message.files || [];
        event.attachments = event.previous_message.attachments || [];
      } else {
        event.text = 'deletes';
      }
      event.subtype = 'me_message';
    }

    // Decode and ircize text
    event.text = this.ircizeText(ircUser, event.text || '');

    // Prevent self-echo
    if (await this.preventSelfEcho(ircUser, event, event.text)) return;

    // Get nick and channel
    let [ircNick, ircTarget] = await ircUser.resolveSlackTarget(event);
    if (!ircNick || !ircTarget) {
      ircUser.logError('Failed resolveSlackTarget; event: ' + util.inspect(event));
      return;
    }

    // If not already in channel, join it
    if (this.isChannel(ircTarget) && !ircUser.isInChannel(ircTarget)) {
      await this.onIrcJoinOne(ircUser, ircTarget, event.channel);
    }

    // Use text if not blank, otherwise try rich text
    let messages = [];
    if (event.text) {
      messages.push(event.text);
    } else if (event.blocks) {
      this.extractTextFromBlocks(event.blocks, messages);
    }

    // Also send attachments
    if (event.attachments) {
      event.attachments.forEach((attachment, idx) => {
        let att = new Set(); // Use a Set to avoid duplicates
        if (attachment.title)       att.add(self.ircizeText(ircUser, attachment.title));
        if (attachment.text)        att.add(self.ircizeText(ircUser, attachment.text));
        if (attachment.title_link)  att.add(attachment.title_link);
        if (attachment.fallback)    att.add(self.ircizeText(ircUser, attachment.fallback));
        if (attachment.from_url)    att.add(attachment.from_url);
        if (attachment.image_url)   att.add(attachment.image_url);
        att.forEach((a) => { messages.push('> ' + a); });
      });
    }

    // Also send files
    if (event.files) {
      event.files.forEach((file, idx) => {
        if (file.url_private) messages.push('> ' + file.url_private);
        else if (file.id)     messages.push('> ' + file.id);
      });
    }

    // Send to IRC, once for each newline
    let sentCount = 0;
    messages.forEach((message, idx) => {
      message.split(/(\r\n|\r|\n)/).forEach((line, idx) => {
        line = line.trim();
        if (line.length < 1) return;
        if (event.thread_ts) line = '@thread-' + event.thread_ts + ' ' + line;
        if (event.subtype === 'me_message') line = self.meText(line);
        self.ircd.write(ircUser.socket, ircNick, 'PRIVMSG', [ ircTarget, ':' + line ]);
        sentCount += 1;
      });
    });

    // Warn if no PRIVMSG was sent
    if (sentCount < 1) {
      ircUser.logError('Incoming slack message produced no PRIVMSG: ' + util.inspect(event, false, null));
    }
  }
  extractTextFromBlocks(elements, messages) {
    const self = this;
    elements.forEach((element) => {
      if (element.text) {
        messages.push(element.text);
      }
      if (element.elements) {
        self.extractTextFromBlocks(element.elements, messages);
      }
    });
  }
  async onSlackTopicChange(ircUser, event) {
    // Get nick and channel
    let [ircNick, ircChan] = await ircUser.resolveSlackTarget(event);
    if (!ircNick || !ircChan) return;

    // Decode entities, ircize text
    event.topic = this.ircizeText(ircUser, event.topic);

    // Send topic message
    this.ircd.write(ircUser.socket, ircNick, 'TOPIC', [ ircChan, event.topic ]);
  }
  async onSlackChannelJoined(ircUser, event) {
    let chanId = event.channel.id || event.channel;
    let ircChan = await ircUser.resolveSlackChannel(chanId);
    if (ircChan) {
      await this.onIrcJoinOne(ircUser, ircChan, chanId);
    }
  }
  async onSlackChannelLeft(ircUser, event) {
    let ircChan = await ircUser.resolveSlackChannel(event.channel);
    if (ircChan) {
      await this.onIrcPart(ircUser, { args: [ ircChan ] }, event.channel);
    }
  }
  async onSlackChannelRename(ircUser, event) {
    let oldIrcChan = await ircUser.resolveSlackChannel(event.channel.id);
    let newIrcChan = ircUser.getIrcChannelName(event.channel.name);
    let isInChan = ircUser.isInChannel(oldIrcChan);
    if (isInChan) {
      this.ircd.write(ircUser.socket, ircUser.ircNick, 'PART', [ oldIrcChan ]);
      ircUser.partChannel(oldIrcChan);
    }
    ircUser.unmapIrcToSlack(oldIrcChan, event.channel.id);
    if (isInChan) await this.onIrcJoinOne(ircUser, newIrcChan, event.channel.id);
  }
  async onSlackChannelCreated(ircUser, event) {
    ircUser.mapIrcToSlack(ircUser.getIrcChannelName(event.channel.name), event.channel.id);
  }
  async onSlackChannelArchive(ircUser, event) {
    await this.onSlackMemberLeftChannel(ircUser, event);
  }
  async onSlackMemberJoinedChannel(ircUser, event) {
    if (ircUser.slackUserIds.has(event.user)) return;
    let [ircNick, ircChan] = await ircUser.resolveSlackTarget(event);
    if (ircNick && ircChan && !ircUser.isNickInChannel(ircChan, ircNick)) {
      ircUser.addNickToChannel(ircChan, ircNick);
      this.ircd.write(ircUser.socket, ircNick, 'JOIN', [ ircChan ]);
    }
  }
  async onSlackMemberLeftChannel(ircUser, event) {
    if (ircUser.slackUserIds.has(event.user)) return;
    let [ircNick, ircChan] = await ircUser.resolveSlackTarget(event);
    if (ircNick && ircChan && ircUser.isNickInChannel(ircChan, ircNick)) {
      ircUser.removeNickFromChannel(ircChan, ircNick);
      this.ircd.write(ircUser.socket, ircNick, 'PART', [ ircChan ]);
    }
  }
  async onSlackMpimOpen(ircUser, event) {
    await this.onSlackChannelJoined(ircUser, event);
  }
  async onSlackMpimClose(ircUser, event) {
    await this.onSlackChannelLeft(ircUser, event);
  }
  async onSlackSubteamUpdated(ircUser, event) {
    ircUser.mapIrcToSlack(event.subteam.handle, event.subteam.id);
  }
  async onSlackSubteamSelfAdded(ircUser, event) {
    ircUser.slackSubteamIds.add(event.subteam_id);
  }
  async onSlackSubteamSelfRemoved(ircUser, event) {
    ircUser.slackSubteamIds.delete(event.subteam_id);
  }
  async onSlackReactionAdded(ircUser, event) {
    await this.onSlackReaction(ircUser, event, 'reacts');
  }
  async onSlackReactionRemoved(ircUser, event) {
    await this.onSlackReaction(ircUser, event, 'unreacts');
  }
  async onSlackReaction(ircUser, event, verb) {
    if (!ircUser.reactionsEnabled()) return;
    if (event.item.type !== 'message') return;
    if (!event.item_user) {
      let history = await ircUser.slackWeb.apiCallOrThrow('conversations.replies', {
        channel: event.item.channel,
        ts: event.item.ts,
        limit: 1,
        inclusive: 1,
      });
      if (history.messages.length > 0
        && history.messages[0].ts === event.item.ts
        && (history.messages[0].user || history.messages[0].bot_id)
      ) {
        event.item_user = history.messages[0].user || history.messages[0].bot_id;
      } else {
        ircUser.logError('No message found for event.item.ts=' + event.item.ts + '; history=' + util.inspect(history));
        return;
      }
    }
    let ircReacter = ircUser.resolveSlackUser(event.user);
    let ircReactee = ircUser.resolveSlackUser(event.item_user);
    let ircChan    = ircUser.resolveSlackChannel(event.item.channel, ircReacter);
    try {
      ircReacter = await ircReacter;
      ircReactee = await ircReactee;
      ircChan    = await ircChan;
      if (!ircReacter || !ircReactee || !ircChan) {
        throw Error('Missing reaction info');
      }
    } catch (e) {
      ircUser.logError(util.inspect(e));
      return;
    }
    let message = this.meText(verb + ' @ ' + ircReactee + ' :' + event.reaction + ':');
    this.ircd.write(ircUser.socket, ircReacter, 'PRIVMSG', [ ircChan, message ]);
  }
  async onSlackUserTyping(ircUser, event) {
    if (!ircUser.typingNotificationsEnabled()) {
      return;
    }
    let [ircNick, ircTarget] = await ircUser.resolveSlackTarget(event);
    if (!ircNick || !ircTarget) {
      ircUser.logError('Failed resolveSlackTarget; event: ' + util.inspect(event));
      return;
    }
    console.log('slack_typing', ircNick, ircTarget);
    let line = this.typingText('1');
    this.ircd.write(ircUser.socket, ircNick, 'PRIVMSG', [ ircTarget, line ]);
  }
  async onSlackPresenceChange(ircUser, event) {
    if (!ircUser.presenceEnabled()) {
      return;
    }
    let ircNick = await ircUser.resolveSlackUser(event.user);
    let ircMode = null;
    if (event.presence === 'away') {
      ircUser.ircNickActive.delete(ircNick);
      ircMode = '-v';
    } else {
      ircUser.ircNickActive.add(ircNick);
      ircMode = '+v';
    }
    console.log('slack_presence_change', ircNick, event.presence);
    ircUser.channelNicks.forEach((nicks, channel) => {
      if (nicks.get(ircNick) && ircUser.isInChannel(channel)) {
        this.ircd.write(ircUser.socket, 'irslackd', 'MODE', [channel, ircMode, ircNick]);
      }
    });
  }
  async onSlackTeamJoin(ircUser, event) {
    // Add new member
    let slackUser = event.user.id;
    let ircNick = ircUser.replaceIllegalIrcNickChars(event.user.name);
    ircUser.mapIrcToSlack(ircNick, slackUser);

    // Update presence subscriptions
    this.updatePresenceSubscriptions(ircUser);
  }
  async onIrcWho(ircUser, msg) {
    await this.onIrcWhois(ircUser, msg);
  }
  async onIrcWhois(ircUser, msg) {
    if (msg.args.length < 1) return;
    let ircNick = msg.args[0];
    if (this.isChannel(ircNick)) {
      return; // Ignore channels
    }
    let slackUser;
    try {
      slackUser = ircUser.resolveIrcUser(ircNick);
    } catch (e) {
      return;
    }
    try {
      let user = await ircUser.slackWeb.apiCallOrThrow('users.info', { user: slackUser });
      this.ircd.write(ircUser.socket, 'irslackd', '311', [
        ircUser.ircNick,
        ircNick,
        ircNick,
        'irslackd',
        '*',
        ':' + (user.user.real_name || user.user.profile.display_name || user.user.name),
      ]);
    } catch (e) {
      this.ircd.write(ircUser.socket, 'irslackd', '401', [
        ircUser.ircNick,
        ircNick,
        ':No such nick/channel',
      ]);
    }
  }
  async onIrcAtSlackPrivmsg(ircUser, msg) {
    const self = this;
    const ircTarget = msg.args.shift();
    const cmdStr = msg.args.join(' ').trim();
    const [cmdArgs, cmdArgv] = this.parseAtSlackCmd(cmdStr);
    const atSlackCmd = cmdArgv.shift();

    const slackTarget = ircUser.resolveIrcTarget(ircTarget);

    let slackCmdFunc = null;
    switch (atSlackCmd) {
      case 'history':
        slackCmdFunc = this.onIrcAtSlackHistory;
        break;
      case 'search':
        slackCmdFunc = this.onIrcAtSlackSearch;
        break;
      case 'thread':
        slackCmdFunc = this.onIrcAtSlackThread;
        break;
      case 'react':
        slackCmdFunc = this.onIrcAtSlackReact;
        break;
      case 'unreact':
        slackCmdFunc = this.onIrcAtSlackUnreact;
        break;
      case 'chat':
        slackCmdFunc = this.onIrcAtSlackChat;
        break;
      case 'subteams':
        slackCmdFunc = this.onIrcAtSlackSubteams;
        break;
      default:
    }
    const messages = await slackCmdFunc.call(this, ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv);
    messages.forEach((message, idx) => {
      message.split(/(\r\n|\r|\n)/).forEach((line, idx) => {
        line = line.trim();
        if (line.length < 1) return;
        self.ircd.write(ircUser.socket, 'irslackd', 'NOTICE', [ ircTarget, ':' + line ]);
      });
    });
  }
  async onIrcAtSlackHistory(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    const history = await ircUser.slackWeb.apiCallOrThrow('conversations.history', {
      channel: slackTarget,
      limit: cmdArgs['limit'] || cmdArgs['l'] || 20,
    });
    return history.messages.map(h => JSON.stringify(h)).reverse();
  }
  async onIrcAtSlackSearch(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    const results = await ircUser.slackWeb.apiCallOrThrow('search.messages', {
      query: cmdArgv.join(' '),
      count: cmdArgs['limit'] || cmdArgs['l'] || 20,
      sort: 'timestamp',
    });
    return results.messages.matches.map((m) => {
      const ircChan = ircUser.slackToIrc.get(m.channel.id) || m.channel.id;
      const ircNick = ircUser.slackToIrc.get(m.user)       || m.user;
      return ircChan + ' @' + m.ts + ' <' + ircNick + '> ' + m.text;
    });
  }
  async onIrcAtSlackThread(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    const ts = cmdArgv.shift();
    const replies = await ircUser.slackWeb.apiCallOrThrow('conversations.replies', {
      channel: slackTarget,
      ts: ts,
      limit: cmdArgs['limit'] || cmdArgs['l'] || 1,
    });
    return replies.messages.map(h => JSON.stringify(h));
  }
  async onIrcAtSlackReact(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    return await this.onIrcAtSlackReactUnreact(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv, 'reactions.add');
  }
  async onIrcAtSlackUnreact(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    return await this.onIrcAtSlackReactUnreact(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv, 'reactions.remove');
  }
  async onIrcAtSlackReactUnreact(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv, reactMethod) {
    await ircUser.slackWeb.apiCallOrThrow(reactMethod, {
      channel: slackTarget,
      timestamp: cmdArgv.shift(),
      name: cmdArgv.shift(),
    });
    return [];
  }
  async onIrcAtSlackChat(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    if (cmdArgv.length === 0) {
      return [ 'You must specify at least one nickname to chat with.' ];
    }

    let slackUsers = [];
    let errors = [];

    for (let ircNick of cmdArgv) {
      try {
        slackUsers.push(ircUser.resolveIrcUser(ircNick));
      } catch (e) {
        errors.push('Unknown nickname: ' + ircNick);
      }
    }

    if (errors.length > 0) {
      return errors;
    }

    await ircUser.slackWeb.apiCallOrThrow('conversations.open', {
      users: slackUsers.join(','),
    });

    return [];
  }
  async onIrcAtSlackSubteams(ircUser, ircTarget, slackTarget, cmdArgs, cmdArgv) {
    let msgs = [ 'Member of ' + ircUser.slackSubteamIds.size + ' subteam(s):' ];
    ircUser.slackSubteamIds.forEach((sid) => {
      const handle = ircUser.slackToIrc.get(sid);
      msgs.push(handle || sid);
    });
    return msgs;
  }
  parseAtSlackCmd(cmdStr) {
    let cmdArgv = [];
    let cmdArgs = {};
    let token = '';
    let argToken = false;
    let inEscape = false;
    let inQuote = false;
    let inArg = false;
    const processToken = () => {
      if (!inQuote && token.trim() === '') {
        'Hi mom';
      } else if (inArg) {
        argToken = token;
        cmdArgs[argToken] = true;
        inArg = false;
      } else if (argToken) {
        cmdArgs[argToken] = token;
        argToken = false;
      } else {
        cmdArgv.push(token);
      }
      token = '';
    };
    for (let i = 0; i < cmdStr.length; i++) {
      const c = cmdStr.substr(i, 1);
      if (inEscape) {
        token += c;
        inEscape = false;
      } else if (c === '\\') {
        inEscape = true;
      } else if (!inQuote && (c === '"' || c === "'")) {
        processToken(token);
        inQuote = c;
      } else if (c === inQuote) {
        processToken(token);
        inQuote = false;
      } else if (token === '' && c === '-') {
        inArg = true;
      } else if (inArg && !inQuote && c === '=') {
        processToken(token);
      } else if (!inQuote && c.trim() === '') {
        processToken(token);
      } else {
        token += c;
      }
    }
    processToken(token);
    return [ cmdArgs, cmdArgv ];
  }
  onIrcDebugPrivmsg(ircUser, msg) {
    let cmd = msg.args[0];
    let out = null;
    const iOpts = { depth: 3, showHidden: true };
    switch (cmd) {
      case 'dump_server': out = util.inspect(this, iOpts);               break;
      case 'dump_user':   out = util.inspect(ircUser, iOpts);            break;
      case 'dump_rtm':    out = util.inspect(ircUser.slackRtm, iOpts);   break;
      case 'dump_web':    out = util.inspect(ircUser.slackWeb, iOpts);   break;
      case 'dump_map':    out = util.inspect(ircUser.ircToSlack, iOpts); break;
    }
    if (out) console.log('debug', cmd, out);
  }
  onIrcDebugJoin(ircUser) {
    ircUser.addNickToChannel(debugChannel, ircUser.ircNick);
    this.sendIrcChannelJoin(ircUser, debugChannel, 'irslackd debug', [ ircUser.ircNick ]);
  }
  onIrcDebugPart(ircUser) {
    ircUser.removeNickFromChannel(debugChannel, ircUser.ircNick);
    this.sendIrcChannelPart(ircUser, debugChannel);
  }
  async onIrcLine(ircUser, line) {
    console.log('irc_in', line);
  }
  async onIrcError(ircUser, err) {
    console.log('irc_err', err);
  }
  async onSlackEvent(ircUser, eventName, event) {
    if (['dnd_updated_user', 'user_profile_changed', 'user_status_changed', 'user_change', 'user_huddle_changed'].includes(eventName)) {
      // These are really noisy
      return;
    }
    let e = util.inspect(event);
    e = ircUser.annotateIds(e);
    console.log('slack_in', eventName, e);
  }
  sendIrcChannelJoin(ircUser, ircChan, topic, ircNicks) {
    // Bail if already in
    if (ircUser.isInChannel(ircChan)) {
    //  return;
    }

    // Set channel marker
    ircUser.joinChannel(ircChan, ircNicks);

    // Join IRC channel
    this.ircd.write(ircUser.socket, ircUser.ircNick, 'JOIN', [ ircChan ]);
    if (topic) {
      topic = this.ircizeText(ircUser, topic);
      this.ircd.write(ircUser.socket, 'irslackd', '332', [ ircUser.ircNick, ircChan, ':' + topic ]);
    }

    // Send nicks in chunks of 20
    let nickChunkSize = 20;
    for (let i = 0; i < ircNicks.length; i += nickChunkSize) {
      this.ircd.write(ircUser.socket, 'irslackd', '353', [
        ircUser.ircNick,
        '=',
        ircChan,
        ircNicks.slice(i, i + nickChunkSize).map((ircNick) => {
          return ircUser.ircNickActive.has(ircNick) ? '+' + ircNick : ircNick;
        }).join(' '),
      ]);
    }
    this.ircd.write(ircUser.socket, 'irslackd', '366', [ ircUser.ircNick, ircChan, ':End of /NAMES list' ]);
  }
  sendIrcChannelPart(ircUser, ircChan) {
    // Unset channel marker and leave IRC channel
    if (ircUser.partChannel(ircChan)) {
      this.ircd.write(ircUser.socket, ircUser.ircNick, 'PART', [ ircChan ]);
    }
  }
  updatePresenceSubscriptions(ircUser) {
    if (!ircUser.presenceEnabled()) {
      return;
    }
    let userIds = ircUser.getAllSlackUserIds();
    console.log('Subscribing to presence of', userIds.length, 'users');
    ircUser.slackRtm.subscribePresence(userIds);
  }
  ctcpCommand(command, text) {
    return String.fromCharCode(1) + command + ' ' + text + String.fromCharCode(1);
  }
  isCtcpCommand(command, message) {
    command = command + ' ';
    return message.charCodeAt(0) === 1 && message.substr(1, command.length) === command;
  }
  meText(text) {
    return this.ctcpCommand('ACTION', text);
  }
  typingText(level) {
    return this.ctcpCommand('TYPING', level);
  }
  decodeEntities(text) {
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    return text;
  }
  ircizeText(ircUser, text) {
    text = this.decodeEntities(text);
    if (text.indexOf('`') === -1) {
      return this.ircizeTextChunk(ircUser, text);
    }
    let tripleBacktickChunks = text.split('```');
    for (let i3 = 0; i3 < tripleBacktickChunks.length; i3++) {
      const inTripleBacktick = (i3 % 2 === 1 && i3 < tripleBacktickChunks.length - 1);
      if (inTripleBacktick) {
        tripleBacktickChunks[i3] = '```' + tripleBacktickChunks[i3];
      } else {
        let singleBacktickChunks = tripleBacktickChunks[i3].split('`');
        for (let i1 = 0; i1 < singleBacktickChunks.length; i1++) {
          const inSingleBacktick = (i1 % 2 === 1 && i1 < singleBacktickChunks.length - 1);
          if (inSingleBacktick) {
            singleBacktickChunks[i1] = '`' + singleBacktickChunks[i1];
          } else {
            singleBacktickChunks[i1] = (i1 > 0 ? '`' : '') + this.ircizeTextChunk(ircUser, singleBacktickChunks[i1]);
          }
        }
        tripleBacktickChunks[i3] = (i3 > 0 ? '```' : '') + singleBacktickChunks.join('');
      }
    }
    return tripleBacktickChunks.join('');
  }
  ircizeTextChunk(ircUser, text) {
    if (text.indexOf('<') === -1) return text;
    return text.replace(/<(http|mailto:|#|@|!subteam\^|!here|!channel|!date)([^>|]*)[^>]*>/g, (match, prefix, slackId) => {
      if (prefix === 'http') {
        let link = match.substr(1, match.length - 2);
        let pipe = link.lastIndexOf('|');
        if (pipe >= 0) link = '<' + link.substr(0, pipe) + '> ' + '(' + link.substr(pipe + 1) + ')';
        return link;
      } else if (prefix === 'mailto:') {
        return slackId;
      } else if (prefix === '!here') {
        return '@here';
      } else if (prefix === '!channel') {
        return '@channel';
      } else if (prefix === '!date') {
        let date = match.substr(1, match.length - 2);
        let pipe = date.lastIndexOf('|');
        if (pipe >= 0) return date.substr(pipe + 1);
      } else if (slackId === '') {
        return match;
      }
      let ircTarget = ircUser.slackToIrc.get(slackId);
      if (!ircTarget) {
        ircUser.resolveSlackId(slackId).catch((e) => {
          if (e && !e.ok) {
            ircUser.addToFalseIds(slackId);
          } else {
            ircUser.logError('Failed resolveSlackId: ' + util.inspect(e));
          }
        }); // Async
        return match;
      }
      if (prefix === '!subteam^') {
        prefix = '@';
      } else if (prefix === '#') {
        prefix = ''; // Already part of ircTarget
      }
      return ircTarget ? (prefix + ircTarget) : match;
    });
  }
  slackizeText(ircUser, text) {
    if (text.indexOf('@') === -1 && text.indexOf('#') === -1) return text;
    return text.replace(/([^\w-]|^)([#@])([\w-]+)/g, (match, lookbehind, prefix, ircTarget) => {
      let suffix = '';
      let slackTarget = '';

      if (prefix === '#') ircTarget = '#' + ircTarget;

      if ((ircTarget === 'here') || (ircTarget === 'channel')) {
        prefix = '!';
        slackTarget = ircTarget;
      } else {
        try {
          slackTarget = ircUser.resolveIrcTarget(ircTarget);
        } catch (e) {
          ircUser.logError('No slackizeText match for: ' + ircTarget);
          return match;
        }

        if (prefix === '#') {
          prefix = '#';
          suffix = '|' + ircTarget.substr(1);
        } else if (['U', 'W'].includes(slackTarget.substr(0, 1))) {
          prefix = '@';
        } else {
          prefix = '!subteam^';
          suffix = '|@' + ircTarget;
        }
      }
      return lookbehind + '<' + prefix + slackTarget + suffix + '>';
    });
  }
  isMpdmChannel(chanOrNick) {
    return ((chanOrNick.charAt(0) === '&') || (chanOrNick.substr(0, 6) === '#mpdm-')) && !this.isDebugChannel(chanOrNick);
  }
  isNormalChannel(chanOrNick) {
    return chanOrNick.charAt(0) === '#' && !this.isDebugChannel(chanOrNick);
  }
  isDebugChannel(chanOrNick) {
    return chanOrNick === debugChannel;
  }
  isChannel(chanOrNick) {
    return this.isNormalChannel(chanOrNick) || this.isMpdmChannel(chanOrNick) || this.isDebugChannel(chanOrNick);
  }
  extractThread(text) {
    let re = /^@thread-([^ ]+) /;
    let match = re.exec(text);
    if (match) {
      return [ text.replace(re, ''), match[1] ];
    }
    return [ text, null ];
  }
  async rememberSelfEcho(ircUser, message, apiCb) {
    await ircUser.selfEchoLock.acquireAsync();
    try {
      let chat = await apiCb();
      let maxSelfEchoEntries = 1024;
      ircUser.selfEchoList.unshift(this.selfEchoKeyFromEvent(chat, message));
      ircUser.selfEchoList = ircUser.selfEchoList.slice(0, maxSelfEchoEntries);
    } finally {
      ircUser.selfEchoLock.release();
    }
  }
  async preventSelfEcho(ircUser, event, message) {
    let shouldSkipMessage = false;
    if (!ircUser.slackUserIds.has(event.user)) {
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
  makeIrcHandler(method, requireInit) {
    const self = this;
    return async function() {
      const args = Array.from(arguments);
      const socket = args.shift();
      const ircUser = self.socketMap.get(socket);
      if (ircUser) {
        if (requireInit) {
          await ircUser.initialized();
        }
        args.unshift(ircUser);
        let res = method.apply(self, args);
        if (typeof res === 'object' && typeof res.catch === 'function') {
          res.catch((e) => {
            ircUser.logError('Failed ' + method.name + ': ' + util.inspect(e));
          });
        }
      } else {
        ircUser.logError('Could not find user state for socket ' + socket);
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
          res.catch((e) => {
            ircUser.logError(
              'Failed ' + method.name + ' args=' + util.inspect(args.slice(1)) +
              ' err=' + util.inspect(e),
            );
          });
        }
      } else {
        console.trace('irslackd_err', 'Could not find user state for rtm ' + rtm);
      }
    };
  }
  async apiCallOrThrow(method, params) {
    let e = util.inspect(params);
    if (this.ircUser) {
      e = this.ircUser.annotateIds(e);
    }
    console.log('slack_out', method, e);

    let result;
    try {
      result = await this.apiCall(method, params);
      if (!result.ok) throw result;
    } catch (e) {
      throw Error(JSON.stringify({
        method: method,
        params: params,
        error: e,
      }, null, 2));
    }
    return result;
  }
  async paginateCallOrThrow(method, aggKey, params) {
    let results, result;
    params = params || {};
    while (1) {
      result = await this.apiCallOrThrow(method, params);
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
      params.cursor = result.response_metadata.next_cursor;
    }
    return results;
  }
  async setSlackPresence(ircUser, active) {
    let status = (active) ? 'auto' : 'away';
    await ircUser.slackWeb.apiCallOrThrow('users.setPresence', { presence: status });
  }
  // Dependency injectors
  getNewIrcd(config) {
    return new ircd.Ircd(config);
  }
  getNewSlackWebClient(token, cookie = null) {
    const params = cookie ? { headers: { Cookie: cookie }} : {};
    return new slack.WebClient(token, params);
  }
  getNewSlackRtmClient(token, cookie = null) {
    const params = cookie ? { tls: { headers: { Cookie: cookie }}} : {};
    // Let's hope they don't do this:
    // https://github.com/slackapi/node-slack-sdk/blob/aa269d160f10b3414812ee335b1dfa961d214c77/packages/rtm-api/src/RTMClient.ts#L338
    return new slack.RTMClient(token, Object.assign(params, {
      logLevel: this.config.rtmClientLogLevel || 'info',
      retryConfig: { forever: true, maxTimeout: 60000 },
    }));
  }
}

class IrcUser {
  constructor(socket, ircd) {
    const self = this;
    this.socket = socket;
    this.ircd = ircd;
    this.ircNick = 'user';
    this.ircNickLocked = false;
    this.slackToken = 'token';
    this.slackCookie = null;
    this.slackUserId = 'uid';
    this.slackUserIds = new Set();
    this.slackSubteamIds = new Set();
    this.slackWeb = null;
    this.slackRtm = null;
    this.channelNicks = new Map();
    this.ircToSlack = new Map(); // #channel => Set(C12345678, ...), nick => Set(U13371337, ...)
    this.slackToIrc = new Map(); // C12345678 => #channel, U13371337 => nick
    this.ircNickToSlackChanId = new Map();
    this.ircNickActive = new Set();
    this.selfEchoList = [];
    this.selfEchoLock = new AwaitLock();
    this.falseIds = new Set();
    this.preferences = [];
    this.initializeResolveFn = null;
    this.initializePromise = new Promise((resolve, reject) => {
      self.initializeResolveFn = resolve;
    });
  }
  setInitialized() {
    this.initializeResolveFn(true);
  }
  async initialized() {
    return await this.initializePromise;
  }
  isInChannel(ircChan) {
    return this.isNickInChannel(ircChan, this.ircNick);
  }
  isNickInChannel(ircChan, ircNick) {
    const chanMap = this.channelNicks.get(ircChan);
    return chanMap && chanMap.get(ircNick);
  }
  joinChannel(ircChan, ircNicks) {
    this.channelNicks.set(ircChan, new Map());
    ircNicks.forEach((ircNick) => {
      this.addNickToChannel(ircChan, ircNick);
    });
  }
  partChannel(ircChan) {
    return this.channelNicks.delete(ircChan);
  }
  addNickToChannel(ircChan, ircNick) {
    let nickMap = this.channelNicks.get(ircChan);
    if (!nickMap) {
      nickMap = new Map();
      this.channelNicks.set(ircChan, nickMap);
    }
    return nickMap.set(ircNick, true);
  }
  removeNickFromChannel(ircChan, ircNick) {
    let nickMap = this.channelNicks.get(ircChan);
    if (nickMap) {
      return nickMap.delete(ircNick, true);
    }
    return false;
  }
  getAllSlackUserIds() {
    let userIds = [];
    this.slackToIrc.forEach((ircNick, userId) => {
      if (userId[0] === 'U') {
        userIds.push(userId);
      }
    });
    return userIds;
  }
  reactionsEnabled() {
    return this.preferences.indexOf('no-reactions') === -1;
  }
  threadsEnabled() {
    return this.preferences.indexOf('no-threads') === -1;
  }
  debugChannelEnabled() {
    return this.preferences.indexOf('debug-chan') !== -1;
  }
  typingNotificationsEnabled() {
    return this.preferences.indexOf('typing-notifications') !== -1;
  }
  presenceEnabled() {
    return this.preferences.indexOf('presence') !== -1;
  }
  shortGroupChatNamesEnabled() {
    return this.preferences.indexOf('short-group-chat-names') !== -1;
  }
  getSlackId(ircTarget) {
    const set = this.ircToSlack.get(ircTarget);
    if (set) {
      for (const id of set) {
        return id; // Return the first id in the set
      }
    }
    return null;
  }
  unmapIrcToSlack(ircTarget, slackId) {
    const slackIds = this.ircToSlack.get(ircTarget) || new Set();
    this.ircToSlack.delete(ircTarget);

    slackIds.add(slackId);
    for (const slackId of slackIds) {
      this.slackToIrc.delete(slackId);
    }
  }
  mapIrcToSlack(ircTarget, slackId) {
    // According to Slack support, there can be multiple ids per object, so
    // make `ircToSlack` a `Map` of `Set`s of strings. `slackToIrc` can remain
    // a simple `Map` of strings.
    const slackIds = this.ircToSlack.get(ircTarget) || new Set();
    slackIds.add(slackId);
    this.ircToSlack.set(ircTarget, slackIds);
    this.slackToIrc.set(slackId, ircTarget);
  }
  addToFalseIds(id) {
    this.falseIds.add(id);
  }
  async resolveSlackId(id) {
    if (this.falseIds.has(id)) return;
    switch (id.charAt(0)) {
      case 'U':
      case 'W': await this.resolveSlackUser(id); break;
      case 'B': await this.resolveSlackBot(id); break;
      case 'C':
      case 'D':
      case 'G': await this.resolveSlackChannel(id); break;
      default: this.logError('Unrecognized id type in resolveSlackId: ' + id); break;
      // TODO: Unrecognized id type in resolveSlackId: S01TKTKTKTK (<!subteam^S01TKTKTKTK|@blahblah>)
    }
  }
  async resolveSlackTarget(event) {
    let ircNick = null;
    let ircChan = null;
    if (event.user) {
      ircNick = this.resolveSlackUser(event.user);
    } else if (event.username) {
      ircNick = event.username;
    } else if (event.message && event.message.username) {
      ircNick = event.message.username;
    } else if (event.previous_message && event.previous_message.username) {
      ircNick = event.previous_message.username;
    } else if (event.bot_profile && event.bot_profile.name) {
      ircNick = event.bot_profile.name;
    } else if (event.bot_id) {
      ircNick = this.resolveSlackBot(event.bot_id);
    } else if (event.previous_message && event.previous_message.bot_id) {
      ircNick = this.resolveSlackBot(event.previous_message.bot_id);
    } else {
      // Slack sometimes sends events that are unattributable. We could
      // potentially lookup conversation history at this point to figure out the
      // user/bot. However, this is pretty infrequent overall, and I've only
      // seen this behavior with bots, so let's give up.
      if (!event.hidden) {
        this.logError('Could not resolveSlackTarget for event: ' + util.inspect(event));
      }
      ircNick = 'unknown';
    }
    if (event.channel) {
      ircChan = this.resolveSlackChannel(event.channel, ircNick);
    }
    try {
      if (ircNick) ircNick = await ircNick;
      if (ircChan) ircChan = await ircChan;
    } catch (e) {
      this.logError(util.inspect(e));
    }
    ircNick = this.replaceIllegalIrcNickChars(ircNick);
    return [ ircNick, ircChan ];
  }
  resolveIrcTarget(ircTarget) {
    if (ircTarget.substr(0, 1) === '#') {
      return this.resolveIrcChannel(ircTarget);
    }
    return this.resolveIrcUser(ircTarget);
  }
  resolveIrcChannel(ircChan) {
    const slackChan = this.getSlackId(ircChan);
    if (!slackChan) {
      throw Error('No entry in ircToSlack for channel ' + ircChan);
    }
    return slackChan;
  }
  resolveIrcUser(ircNick) {
    const slackUser = this.getSlackId(ircNick);
    if (!slackUser) {
      throw Error('No entry in ircToSlack for nick ' + ircNick);
    }
    return slackUser;
  }
  async resolveSlackChannel(slackChan, ircSender) {
    // Check cache
    let ircChan = this.slackToIrc.get(slackChan);
    if (ircChan) return ircChan;

    // Try conversations.info
    let convo = await this.slackWeb.apiCallOrThrow('conversations.info', { channel: slackChan });

    if (convo.channel.is_im) {
      if (await ircSender === await this.ircNick) {
        // It's an IM and we're the sender, so the target is the other user
        return this.resolveSlackUser(convo.channel.user);
      } else {
        // It's an IM and we're not the sender, so the target is us
        return this.ircNick;
      }
    }

    // Set cache; return
    ircChan = this.getIrcChannelName(convo.channel.name);

    this.mapIrcToSlack(ircChan, slackChan);
    return ircChan;
  }
  async resolveSlackUser(slackUser) {
    // Check cache
    let ircNick = this.slackToIrc.get(slackUser);
    if (ircNick) return ircNick;

    // Delegate to resolveSlackBot if it looks like a bot_id
    if (slackUser.substr(0, 1) === 'B') {
      return await this.resolveSlackBot(slackUser);
    }

    // Try users.info
    const user = await this.slackWeb.apiCallOrThrow('users.info', { user: slackUser });

    // Special case for when we have multiple user_ids
    // According to Slack support this is OK...
    if (user.user.id !== slackUser
      && this.slackUserIds.has(user.user.id)
      && !this.slackUserIds.has(slackUser)
    ) {
      this.slackUserIds.add(slackUser);
    }

    // Pluck off our enterprise user wd (W)
    if (slackUser === this.slackUserId
      && user.user.enterprise_user
      && user.user.enterprise_user.id
    ) {
      this.slackUserIds.add(user.user.enterprise_user.id);
    }

    // Set cache; return
    ircNick = this.replaceIllegalIrcNickChars(user.user.name);
    this.mapIrcToSlack(ircNick, slackUser);
    return ircNick;
  }
  async resolveSlackBot(slackBotId) {
    // Check cache
    let ircNick = this.slackToIrc.get(slackBotId);
    if (ircNick) return ircNick;

    // Try bots.info
    let bot = await this.slackWeb.apiCallOrThrow('bots.info', { bot: slackBotId });

    // Set cache; return
    ircNick = this.replaceIllegalIrcNickChars(bot.bot.name);
    this.mapIrcToSlack(ircNick, bot.bot.user_id || slackBotId);
    return ircNick;
  }
  getIrcChannelName(slackName) {
    const self = this;
    if (this.shortGroupChatNamesEnabled() && (slackName.substr(0, 4) === 'mpdm')) {
      // Group chat names are of the form #mpdm-myself--user1--user2--user3-n
      // Remove "#mpdm-" prefix and numeric suffix
      let nickstr = slackName.substr(5).replace(/-\d+$/, '');
      let nicks =
        nickstr
          // Split out the participant names
          .split('--')
          // Take current user nick out as it's redundant
          .filter((n) => { return n !== self.ircNick; });

      return '&' + this.replaceIllegalIrcChanChars(nicks.join('-'));
    } else {
      return '#' + this.replaceIllegalIrcChanChars(slackName);
    }
  }
  replaceIllegalIrcChanChars(ircChan) {
    return ircChan.replace(/[\x00\x07\x0a\x0d ,:]/g, '_');
  }
  normalizeIrcChan(unsafeIrcChan) {
    let ircChan = this.replaceIllegalIrcChanChars(unsafeIrcChan);
    const chanPrefix = ircChan.charAt(0);
    if (chanPrefix === '+' || chanPrefix === '!') {
      // These are legal channel prefixes but for simplicity let's convert
      ircChan = '#' + ircChan.substr(1);
    } else if (chanPrefix === '#' || chanPrefix === '&') {
      // No problem
    } else {
      // Prefix was invalid; convert to #blah
      ircChan = '#' + ircChan;
    }
    return ircChan; // Always returns something like #blah or &blah
  }
  logError(err) { // TODO warn, info, error
    // Log trace to console
    console.trace('irslackd_err', err);

    // Log to debug channel if needed
    this.maybeSendIrcDebug('[E]', err);
  }
  maybeSendIrcDebug(prefix, debugStr) {
    // Write to debug channel if needed
    if (!this.isInChannel(debugChannel)) return;

    // Annotate ids
    debugStr = this.annotateIds(debugStr);

    // "At" user
    debugStr = '@' + this.ircNick + ': ' + debugStr;

    // Send to debug chan
    const self = this;
    debugStr.split(/\n/).forEach((debugLine, idx) => {
      for (let i = 0; i < debugLine.length; i += 256) {
        self.ircd.write(self.socket, 'irslackd', 'PRIVMSG', [
          debugChannel,
          prefix + ' ' + debugLine.substr(i, 256),
        ]);
      }
    });
  }
  annotateIds(str) {
    const self = this;
    // Annotate slack ids with IRC equivalents in parenthesis
    return str.replace(/(?<=["'])([A-Z][A-Z0-9]{8,})(?=['"])/g, function(id) {
      const ircTarget = self.slackToIrc.get(id);
      if (ircTarget) {
        return id + ' (' + ircTarget + ')';
      }
      return id;
    });
  }
  replaceIllegalIrcNickChars(ircNick) {
    return ircNick.replace(/[^a-zA-Z0-9_\\\[\]{}`|-]/g, '_');
  }
}

exports.Irslackd = Irslackd;
