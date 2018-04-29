# irslackd

[Slack is ending IRC support][0] on May 15, 2018. So, let's build our
own Slack-IRC gateway.

### Setup

1. [Authorize irslackd][1] on your Slack workspace. Note the access token.
2. Run `./bin/create_tls_key.sh` to create a TLS key and cert. This will put
   a private key and cert in `~/.irslackd`.
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
5. Enjoy a fresh IRC gateway experience

### TODO

* (See [Github issues][2])
* Missing lots of error checking
* Get review from someone who actually writes JavaScript
* Forward errors, notices, debug, etc to client
* Prevent exhausting rate limits
* Handle more Slack events, more of IRC protocol
* Add to Slack App Directory
* Add to npm

[0]: https://my.slack.com/account/gateways
[1]: https://slack.com/oauth/authorize?client_id=2151705565.329118621748&scope=client
[2]: https://github.com/adsr/irslackd/issues
