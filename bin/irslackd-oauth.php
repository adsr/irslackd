#!/usr/bin/env php
<?php

// This is an OAuth callback URL suitable for irslackd. It runs at:
// https://rw.rs/~adsr/proxy/irslackd
//
// If you want to adapt it for your own use, it assumes two functions are
// defined:
//
// * `$set_code_fn($code)` - Sets the HTTP response code
// * `$set_header_fn($k, $v)` - Sets an HTTP response header
//
// If you're using a SAPI like mod_php, you can implement these with
// `http_response_code` and `header` respectively.
//
// It also assumes any script stdout (via `echo`) gets sent back to the client
// we're serving. You can wrap this script with `ob_start` and `ob_get_clean`
// if you need the response as a string in your application.
//
// Naturally, fill in `$client_id` and `$client_secret` with your own.

$client_id = '...';
$client_secret = '...';
$oauth_url = 'https://slack.com/api/oauth.access';

$set_header_fn('Content-Type', 'text/plain');

do {
    $err = function($http_code, $msg) use ($set_code_fn) {
        fwrite(STDERR, "ERR: $http_code $msg\n");
        $set_code_fn($http_code);
        echo $msg;
    };

    if (!isset($request['params']['code'])) {
        $err(400, 'Missing OAuth code');
        break;
    }

    $code = $request['params']['code'];

    $data = http_build_query([
        'client_id' => $client_id,
        'client_secret' => $client_secret,
        'code' => $code,
    ]);
    $context = stream_context_create([
        'http' => [
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n".
                        "Content-Length: " . strlen($data) . "\r\n",
            'method'  => "POST",
            'content' => $data,
            'timeout' => 2,
        ],
    ]);

    $result_str = file_get_contents($oauth_url, $use_include_path=false, $context);
    if (!$result_str) {
        $err(500, 'Slack OAuth call failed');
        break;
    }

    $result = json_decode($result_str, $as_array=true);
    if (!$result) {
        $err(500, sprintf('Invalid Slack response: %s', json_encode($result_str)));
        break;
    }
    if (empty($result['ok']) || empty($result['access_token'])) {
        $err(500, sprintf('Slack error: %s', json_encode($result)));
        break;
    }

    $set_code_fn(200);
    printf('irslackd access token: %s', $result['access_token']);
} while(false);
