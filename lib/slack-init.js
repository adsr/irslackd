'use strict';

(function() {
  let initChannels = async function(ircUser) {
    const irslackd = this;
    console.log('slack_out: initChannels');
    let convos = await ircUser.slackWeb.paginateCallOrThrow('conversations.list', 'channels', {
      types: 'public_channel,private_channel,mpim',
      limit: 1000,
    });
    let joinPromises = new Map();
    convos.channels.forEach((convo) => {
      if (convo.is_archived) return;
      if (convo.is_mpim && !convo.is_open) return;
      hydrateChannel(irslackd, ircUser, joinPromises, convo);
    });
    while (joinPromises.size > 0) {
      if (await joinChannel(irslackd, ircUser, joinPromises) === false) {
        break;
      }
    }
  };

  let initUsers = async function(ircUser) {
    console.log('slack_out: initUsers');
    let users = await ircUser.slackWeb.paginateCallOrThrow('users.list', 'members', { limit: 1000 });
    users.members.forEach((user) => {
      // if (user.deleted) return;
      let ircNick = ircUser.replaceIllegalIrcNickChars(user.name);
      ircUser.mapIrcToSlack(ircNick, user.id);
    });
  };

  let initTeams = async function(ircUser) {
    console.log('slack_out: initTeams');
    let teams = await ircUser.slackWeb.apiCallOrThrow('usergroups.list', {
      include_count: false,
      include_disabled: false,
      include_users: true,
      limit: 1000,
    });
    teams.usergroups.forEach((team) => {
      ircUser.mapIrcToSlack(team.handle, team.id);
      ircUser.slackUserIds.forEach((uid) => {
        if (team.users && team.users.includes(uid)) {
          ircUser.slackSubteamIds.add(team.id);
        }
      });
    });
  };

  let hydrateChannel = async function(irslackd, ircUser, joinPromises, convo) {
    convo.ircChan = ircUser.getIrcChannelName(convo.name);

    ircUser.mapIrcToSlack(convo.ircChan, convo.id);

    if (!convo.is_member) return;
    console.log('slack_out: hydrateChannel ' + convo.name + ' as ' + convo.ircChan);
    convo.members = (async function() {
      let members = await ircUser.slackWeb.paginateCallOrThrow('conversations.members', 'members', {
        channel: convo.id,
        limit: 1000,
      });
      members.convo = convo;
      return members;
    })();
    joinPromises.set(convo.ircChan, convo.members);
  };

  let joinChannel = async function(irslackd, ircUser, joinPromises) {
    let members;
    try {
      members = await Promise.race(joinPromises.values());
    } catch (e) {
      ircUser.logError(e);
      return false;
    }
    let ircChan = members.convo.ircChan;
    console.log('irc_out: joinChannel ' + ircChan);
    joinPromises.delete(ircChan);
    let ircNicks = [ ircUser.ircNick ];
    members.members.forEach((userId) => {
      let ircNick = ircUser.slackToIrc.get(userId);
      if (ircNick) {
        ircNicks.push(ircNick);
      } else {
        // Probably deactivated
        // irslackd.logError(ircUser, 'No user for userId ' + userId);
      }
    });
    irslackd.sendIrcChannelJoin(ircUser, ircChan, members.convo.topic.value, ircNicks);
  };

  exports.initChannels = initChannels;
  exports.initUsers = initUsers;
  exports.initTeams = initTeams;
})();
