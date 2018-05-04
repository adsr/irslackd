'use strict';

const util = require('util');

(function() {
  let refreshChannels = async function(ircUser) {
    const irslackd = this;
    let convos;
    try {
      convos = await ircUser.slackWeb.paginateCall('conversations.list', 'channels', {
        types: 'public_channel,private_channel,mpim',
      });
      if (!convos.ok) throw convos;
    } catch (e) {
      irslackd.logError(ircUser, 'Failed conversations.list: ' + util.inspect(e));
      return;
    }
    let joinPromises = new Map();
    convos.channels.forEach((convo) => {
      hydrateChannel(irslackd, ircUser, joinPromises, convo);
    });
    while (joinPromises.size > 0) {
      if (await joinChannel(irslackd, ircUser, joinPromises) === false) {
        break;
      }
    }
  };

  let refreshUsers = async function(ircUser) {
    const irslackd = this;
    let users;
    try {
      users = await ircUser.slackWeb.paginateCall('users.list', 'members');
      if (!users.ok) throw users;
    } catch (e) {
      irslackd.logError(ircUser, 'Failed users.list: ' + util.inspect(e));
      return;
    }

    users.members.forEach((user) => {
      let displayName = (user.profile.display_name) ? user.profile.display_name : user.name;
      ircUser.slackToIrc.set(user.id, displayName);
      ircUser.ircToSlack.set(displayName, user.id);
    });
  };

  let hydrateChannel = async function(irslackd, ircUser, joinPromises, convo) {
    convo.ircChan = '#' + convo.name;
    ircUser.slackToIrc.set(convo.id, convo.ircChan);
    ircUser.ircToSlack.set(convo.ircChan, convo.id);
    if (convo.is_member) {
      convo.members = (async function() {
        let members = await ircUser.slackWeb.paginateCall('conversations.members', 'members', {
          channel: convo.id,
        });
        members.convo = convo;
        return members;
      })();
      joinPromises.set(convo.ircChan, convo.members);
    }
  };

  let joinChannel = async function(irslackd, ircUser, joinPromises) {
    let members;
    try {
      members = await Promise.race(joinPromises.values());
    } catch (e) {
      irslackd.logError(ircUser, e);
      return false;
    }
    let ircChan = members.convo.ircChan;
    joinPromises.delete(ircChan);
    let ircNicks = [ ircUser.ircNick ];
    members.members.forEach((userId) => {
      let ircNick = ircUser.slackToIrc.get(userId);
      if (ircNick) {
        ircNicks.push(ircNick);
      } else {
        irslackd.logError(ircUser, 'No user for userId ' + userId);
      }
    });
    ircUser.inChannel.set(ircChan, true);
    irslackd.ircd.write(ircUser.socket, ircUser.ircNick, 'JOIN', [ ircChan ]);
    if (members.convo.topic.value) {
      irslackd.ircd.write(ircUser.socket, 'irslackd', '332', [ '=', ircChan, ':' + members.convo.topic.value ]);
    }
    irslackd.ircd.write(ircUser.socket, 'irslackd', '353', [ '=', ircChan, ircNicks.join(' ') ]);
  };

  exports.refreshChannels = refreshChannels;
  exports.refreshUsers = refreshUsers;
})();
