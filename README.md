# irslackd

[Slack is ending IRC support][0] on May 15, 2018. So, let's build our
own Slack-IRC gateway.

### Synopsis

1. Install irslackd in your Slack workspace. (I don't think you can
   actually do this until the app is distributed.)
2. Run irslackd
    ```
    $ git clone https://github.com/adsr/irslackd.git
    $ npm install
    $ ./irslackd
    ```
3. [Get a slack token][1]
4. In your IRC client:
   `/connect irc://your-nick:your-slack-token@localhost:6667`
5. Enjoy fresh IRC gateway experience

### TODO

* Add script to automate getting API token
* Figure out `identity.basic` scope and prevent self-echo
* Missing lots of error checking
* Get review from someone who actually writes JavaScript
* Forward errors, notices, debug, etc to client
* Prevent exhausting rate limits
* Handle more Slack events, more of IRC protocol
* Add TLS option
* Add to Slack App Directory
* Add to npm

[0]: https://my.slack.com/account/gateways
[1]: https://gist.github.com/adsr/c91d1d166fcb347009cc4417fd54f4aa
