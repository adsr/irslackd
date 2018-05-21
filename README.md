# irslackd

[Slack ended IRC support][0] on May 15, 2018. So, we built our own Slack-IRC
gateway.

irslackd is actively developed and used daily on a 1000+ user Slack workspace.

### Features

* TLS-encrypted IRCd
* Multiple Slack accounts/workspaces
* Channels, private channels, DMs, group DMs, threads
* Receive reactions, message edits, message deletes, attachments
* Proper en/decoding of @user, #channel, @team tags

### Setup

1. [Install Node >=8.x][1] with npm.

2. [Authorize irslackd][2] on your Slack workspace. Note the access token.
   
   [![Authorize irslackd](https://platform.slack-edge.com/img/add_to_slack.png)][2]

3. Run `./bin/create_tls_key.sh` to create a TLS key and cert. This will put
   a private key and cert in `~/.irslackd`. Note the fingerprint.

4. Run irslackd:
    ```
    $ git clone https://github.com/adsr/irslackd.git
    $ cd irslackd
    $ npm install
    $ ./irslackd
    ```

5. In your IRC client, e.g., WeeChat:
    ```
    /server add irslackd localhost/6697
    /set irc.server.irslackd.password access-token-from-step-1
    /set irc.server.irslackd.ssl on
    /set irc.server.irslackd.ssl_fingerprint fingerprint-from-step-2
    /connect irslackd
    ```

6. Enjoy a fresh IRC gateway experience.

### Contribute

* File bug reports and feature requests via [Github issues][3].
* Feel free to sumbit PRs.

### irslackd Slack workspace

* Feel free to join the [irslackd Slack workspace][4] for testing your
  irslackd setup.

[0]: https://my.slack.com/account/gateways
[1]: https://nodejs.org/
[2]: https://slack.com/oauth/authorize?client_id=2151705565.329118621748&scope=client
[3]: https://github.com/adsr/irslackd/issues
[4]: https://join.slack.com/t/irslackd/shared_invite/enQtMzYzNzk3MTQwOTE0LWI0ZmZmZjZmNzZkMWM1Y2UwMGU2MzUxODg4OTZkYmNmN2VjNjRiZmVlZDRmZGM1ZTMzM2YwYzZhODBkY2QxM2Q
