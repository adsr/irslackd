"use strict";

const net = require('net'),
      EventEmitter = require('events');

class IrcdSingle extends EventEmitter {
  constructor() {
    super();
    const self = this;
    self.socket = null;
    self.server = net.createServer((socket) => {
      if (self.socket) {
        socket.end();
      } else {
        self.socket = socket;
        socket.on('data', self.makeLineScanner());
        socket.on('close', (hadError) => {
          self.socket = null;
        });
      }
    });
  }
  listen(port, host) {
    return this.server.listen(port, host);
  }
  onLine(line) {
    let msg = this.parseLine(line);
    if (msg) {
      this.emit(msg.cmd, msg);
      this.emit('msg', msg);
    }
    this.emit('line', line);
  }
  write(sender, cmd, args) {
    if (!this.socket) {
      this.emit('error', 'Invalid write: No socket');
      return false;
    }
    let line = '';
    if (sender) {
      line += ':' + sender + ' ';
    }
    line += cmd.toUpperCase();
    if (args && args.length > 0) {
      for (let i = 0; i < args.length; i++) {
        line += ' ';
        if (args[i].indexOf(' ') != -1 || args[i].indexOf(':') != -1) {
          if (i == args.length - 1) {
            line += ':';
          } else {
            this.emit('error', 'Invalid write: ' + util.inspect(arguments));
            return false;
          }
        }
        line += args[i];
      }
    }
    line += "\r\n";
    return this.socket.write(line);
  }
  parseLine(line) {
    let short_long = line.trim().split(' :');
    let parts = short_long[0].split(' ');
    let sender = null;
    if (parts[0].substr(0, 1) == ':') {
      sender = parts[0].substr(1);
      parts.shift();
    }
    let cmd = parts.shift();
    if (cmd.length < 1) {
      this.emit('error', 'Invalid line: ' + line);
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
  makeLineScanner() {
    const self = this;
    let buffer = '';
    return function(data) {
      buffer += data;
      let lines = buffer.split(/\r?\n/);
      if (lines.length >= 2) {
        for (let i = 0; i <= lines.length - 2; i++) {
          self.onLine(lines[i]);
        }
        buffer = lines[lines.length - 1];
      }
    };
  }
}

exports.IrcdSingle = IrcdSingle;
