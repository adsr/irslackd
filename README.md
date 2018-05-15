# irslackd

[Slack is ending IRC support][0] on May 15, 2018. So, let's build our own
Slack-IRC gateway.

### Setup

0. Setup Node >=8.x
1. [Authorize irslackd][1] on your Slack workspace. Note the access token.
   
   [![Authorize irslackd](https://platform.slack-edge.com/img/add_to_slack.png)][1]
2. Run `./bin/create_tls_key.sh` to create a TLS key and cert. This will put
   a private key and cert in `~/.irslackd`. Note the fingerprint.
3. Run irslackd:
    ```
    $ git clone https://github.com/adsr/irslackd.git
    $ cd irslackd
    $ npm install
    $ ./irslackd
    ```
4. In your IRC client, e.g., WeeChat:
    ```
    /server add irslackd localhost/6697
    /set irc.server.irslackd.password access-token-from-step-1
    /set irc.server.irslackd.ssl on
    /set irc.server.irslackd.ssl_fingerprint fingerprint-from-step-2
    /connect irslackd
    ```
5. Enjoy a fresh IRC gateway experience.

### Help

* File bug reports and feature requests via [Github issues][2].

### Contributing

* See [Github issues][2].

### irslackd workspace

* Feel free to join the [irslackd Slack workspace][3] for testing your
  setup.

[0]: https://my.slack.com/account/gateways
[1]: https://slack.com/oauth/authorize?client_id=2151705565.329118621748&scope=client
[2]: https://github.com/adsr/irslackd/issues
[3]: https://join.slack.com/t/irslackd/shared_invite/enQtMzYzNzk3MTQwOTE0LWI0ZmZmZjZmNzZkMWM1Y2UwMGU2MzUxODg4OTZkYmNmN2VjNjRiZmVlZDRmZGM1ZTMzM2YwYzZhODBkY2QxM2Q
