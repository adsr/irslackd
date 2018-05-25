#!/bin/bash
set -xe

mkdir -p ~/.irslackd
openssl req -newkey rsa:4096 -nodes -sha512 -x509 -days 3650 -nodes -out ~/.irslackd/cert.pem -keyout ~/.irslackd/pkey.pem
fingerprint=$(openssl x509 -noout -fingerprint -sha512 -inform pem -in ~/.irslackd/cert.pem | cut -d= -f2-)
echo -e "\nFingerprint: $(echo $fingerprint | tr -d ':')"
