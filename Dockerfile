FROM node:8-alpine

MAINTAINER Filip Valder <valder@cesnet.cz>
LABEL maintainer="Filip Valder <valder@cesnet.cz>"

ARG GIT_REPOSITORY=https://github.com/adsr/irslackd.git
ARG GIT_BRANCH=master
ARG SSL_LOCAL_CERTIFICATE_SUBJ="/CN=irslackd docker gateway"

ENV IRSLACKD_PORT=6697

RUN apk update && \
    apk add \
        bash \
        git \
        openssl \
    && \
    mkdir /opt/irslackd && \
    git clone --single-branch -b ${GIT_BRANCH} ${GIT_REPOSITORY} /tmp/irslackd.git && \
    cd /tmp/irslackd.git && \
    git archive ${GIT_BRANCH} | tar -xC /opt/irslackd && \
    cd /opt/irslackd && \
    npm install && \
    ./bin/create_tls_key.sh -s "${SSL_LOCAL_CERTIFICATE_SUBJ}" && \
    rm -rf /tmp/irslackd.git && \
    apk del git && \
    rm -rf /var/cache/apk/*

CMD ["sh", "-c", "/opt/irslackd/irslackd -a 0.0.0.0 -p ${IRSLACKD_PORT}"]
