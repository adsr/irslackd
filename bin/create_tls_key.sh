#!/bin/bash
set -e

die() { echo "$@" >&2; exit 1; }

dir="~/.irslackd"

while getopts ":d:" opt; do
  case $opt in
    d) dir="$OPTARG"
    ;;
    \?) die "Invalid option -$OPTARG"
    ;;
  esac
done

dir=$(eval echo $dir)

mkdir -p $dir || die "Failed to create directory $dir"
set -x
openssl req -newkey rsa:4096 -nodes -sha512 -x509 -days 3650 -nodes -out $dir/cert.pem -keyout $dir/pkey.pem
fingerprint=$(openssl x509 -noout -fingerprint -sha512 -inform pem -in $dir/cert.pem | cut -d= -f2-)
echo -e "\nFingerprint: $(echo $fingerprint | tr -d ':')"
