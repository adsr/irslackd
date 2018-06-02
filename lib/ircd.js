'use strict';

const net = require('net');
const tls = require('tls');
const util = require('util');
const EventEmitter = require('events');

class Ircd extends EventEmitter {
  constructor(tlsOpts) {
    super();
    this.tlsOpts = tlsOpts;
  }
  listen(port, host) {
    const socketFunc = this.onConnect.bind(this);
    const server = this.tlsOpts === false
      ? net.createServer(socketFunc)
      : tls.createServer(this.tlsOpts, socketFunc);
    return server.listen(port, host);
  }
  onConnect(socket) {
    const self = this;
    self.emit('ircConnect', socket);
    socket.on('data', self.makeLineScanner(socket));
    socket.on('error', (err) => {
      self.emit('ircError', socket, err);
    });
    socket.on('close', (hadError) => {
      self.emit('ircClose', socket, hadError);
    });
  }
  onLine(socket, line) {
    let msg = this.parseLine(socket, line);
    if (msg) {
      this.emit(msg.cmd, socket, msg);
      this.emit('ircMsg', socket, msg);
    }
    this.emit('ircLine', socket, line);
  }
  write(socket, sender, cmd, args) {
    let line = '';
    if (sender) {
      line += ':' + sender + ' ';
    }
    line += cmd.toUpperCase();
    if (args && args.length > 0) {
      for (let i = 0; i < args.length; i++) {
        args[i] = args[i].toString().replace(/(\r\n|\r|\n)/g, ' ');
        line += ' ';
        if (args[i].indexOf(' ') !== -1 || args[i].indexOf(':') !== -1) {
          if (i === args.length - 1) {
            if (args[i].substr(0, 1) !== ':') {
              line += ':';
            }
          } else {
            this.emit('ircError', socket, 'Invalid write: ' + util.inspect(args));
            return false;
          }
        }
        line += args[i];
      }
    }
    console.log('irc_out', line);
    line += '\r\n';
    return socket.write(line);
  }
  parseLine(socket, line) {
    let short_long = line.trim().split(' :');
    let parts = short_long[0].split(' ');
    let sender = null;
    if (parts[0].substr(0, 1) === ':') {
      sender = parts[0].substr(1);
      parts.shift();
    }
    let cmd = parts.shift();
    if (cmd.length < 1) {
      this.emit('ircError', socket, 'Invalid line: ' + line);
      return null;
    }
    let args = parts;
    if (short_long.length >= 2) {
      args.push(short_long.slice(1).join(' :'));
    }
    return {
      sender: sender,
      cmd: cmd,
      args: args,
    };
  }
  makeLineScanner(socket) {
    const self = this;
    let buffer = '';
    return function(data) {
      buffer += data;
      let lines = buffer.split(/\r?\n/);
      if (lines.length >= 2) {
        for (let i = 0; i <= lines.length - 2; i++) {
          self.onLine(socket, lines[i]);
        }
        buffer = lines[lines.length - 1];
      }
    };
  }
}

exports.Ircd = Ircd;
