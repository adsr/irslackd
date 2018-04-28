<?php

// This script runs at https://hook.io/as/irslackd

function err($http_code, $msg) {
  http_response_code($http_code);
  echo $msg;
  die();
}

$client_id = isset($Hook['env']['irslackd_client_id'])
  ? $Hook['env']['irslackd_client_id']
  : err(500, 'Missing irslackd_client_id');
$client_secret = isset($Hook['env']['irslackd_client_secret'])
  ? $Hook['env']['irslackd_client_secret']
  : err(500, 'Missing irslackd_client_secret');
$code = isset($Hook['params']['code'])
  ? $Hook['params']['code']
  : err(400, 'Missing OAuth code');
$oauth_url = 'https://slack.com/api/oauth.access';

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
    ],
]);

$result = file_get_contents($oauth_url, $use_include_path=false, $context);
if (!$result)
  err(500, 'Slack OAuth call failed');

$result = json_decode($result, $as_array=true);
if (!$result)
  err(500, sprintf('Invalid Slack response: %s', json_encode($result)));
if (empty($result['ok']) || empty($result['access_token']))
  err(500, sprintf('Slack error: %s', json_encode($result)));

printf('irslackd access token: %s', $result['access_token']);
