# irslackd

[Slack ended IRC support][0] on May 15, 2018. So, we built our own Slack-IRC
gateway.

irslackd is actively developed, works with ZNC and used daily on a 1000+ user Slack workspace.

[![Build Status](https://travis-ci.org/adsr/irslackd.svg?branch=master)](https://travis-ci.org/adsr/irslackd)

### Features

* TLS-encrypted IRCd
* Multiple Slack accounts/workspaces
* Channels, private channels, DMs, group DMs, threads
* Receive reactions, message edits, message deletes, attachments
* Proper en/decoding of @user, #channel, @team tags

### Setup

1. [Install Node >=8.x][1] with npm. You can check your version of Node by running `node --version`.

2. Clone irslackd:
    ```
    $ git clone https://github.com/adsr/irslackd.git
    $ cd irslackd
    ```

3. Run `./bin/create_tls_key.sh` to create a TLS key and cert. This will put
   a private key and cert in `~/.irslackd`. Note the fingerprint.

4. Run irslackd:
    ```
    $ npm install
    $ ./irslackd
    ```
    To start irslackd using a custom port (for example 6679):
    ```
    $ IRSLACKD_LISTEN_PORT=6679 ./irslackd
    ```

5. Obtain a token for your Slack workspace by following the link below. Then select the desired workspace
   in the dropdown (upper right).  Finally save the token (for step 6), it will look similar to this: 
   
   xoxp-jhvbT85cdlku&^b88s78765JHBfrewgsdy7

   [![Token Request](https://platform.slack-edge.com/img/add_to_slack.png)][2]

6. Connect to irslackd

```
IRC client, e.g., WeeChat:

    /server add irslackd_workspace localhost/6697
    /set irc.server.irslackd_workspace.ssl on
    /set irc.server.irslackd_workspace.ssl_fingerprint fingerprint-from-step-3
    /set irc.server.irslackd_workspace.password access-token-from-step-5
    /connect irslackd_workspace

ZNC Bouncer:

    Add a new 'network'
    In 'Servers of this IRC network' enter: 127.0.01 +port# access-token-from-step-5
    In 'Trusted SSL fingerprints of this IRC network' enter: fingerprint-from-step-3
    Connect to ZNC w/your client and enjoy 
```

7. Repeat steps 5 and 6 for each Slack workspace you'd like to connect to.

8. Enjoy a fresh IRC gateway experience.

### Contribute

* File bug reports and feature requests via [Github issues][3].
* Feel free to sumbit PRs.

### Related projects

* https://github.com/ltworf/localslackirc (another gateway, Python)
* https://github.com/insomniacslk/irc-slack (another gateway, Go)
* https://github.com/wee-slack/wee-slack (a terminal client, WeeChat-based)
* https://github.com/erroneousboat/slack-term (a terminal client, Go)
* https://github.com/42wim/matterircd (an IRCd for Mattermost and Slack)
* https://github.com/dylex/slack-libpurple (Slack plugin for libpurple)

### irslackd Slack workspace

* Feel free to join the [irslackd Slack workspace][4] for testing your
  irslackd setup.

[0]: https://my.slack.com/account/gateways
[1]: https://nodejs.org/
[2]: https://slack.com/oauth/authorize?client_id=2151705565.329118621748&scope=client
[3]: https://github.com/adsr/irslackd/issues
[4]: https://join.slack.com/t/irslackd/shared_invite/enQtMzYzNzk3MTQwOTE0LWI0ZmZmZjZmNzZkMWM1Y2UwMGU2MzUxODg4OTZkYmNmN2VjNjRiZmVlZDRmZGM1ZTMzM2YwYzZhODBkY2QxM2Q
