#!/bin/bash
set -o pipefail

testfn() {
    patt=${@:-test_}
    find tests -name "*${patt}*" | xargs -rn1 node | awk -f 'bin/filter-tape.awk'
}

testfn "$@"
