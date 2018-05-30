/^TAP version /         { next }
/^$/                    { next }
/^# tests /             { print; next }
/^# pass /              { print; next }
/^# ok/                 { print; next }
/^# tape output off/    { off=1; next }
/^# tape output on/     { off=0; next }
off==1                  { next }
/^ok/                   { print "\033[1;32m" $0 "\033[0m"; next }
/^not ok/               { print "\033[1;31m" $0 "\033[0m"; next }
/^#/                    { s=sprintf("%40s",""); gsub(/ /, "#",s); printf("\n%s\n%s\n%s\n", s, $0, s); next }
                        { print }
