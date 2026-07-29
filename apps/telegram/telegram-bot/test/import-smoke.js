const childProcess = require('node:child_process');
const fs = require('node:fs');
const dgram = require('node:dgram');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

function rejectNetworkCall() {
  throw new Error('Network access is forbidden during the Telegram import smoke test');
}

http.get = rejectNetworkCall;
http.request = rejectNetworkCall;
https.get = rejectNetworkCall;
https.request = rejectNetworkCall;
childProcess.exec = rejectNetworkCall;
childProcess.execFile = rejectNetworkCall;
childProcess.fork = rejectNetworkCall;
childProcess.spawn = rejectNetworkCall;
dgram.createSocket = rejectNetworkCall;
dns.lookup = rejectNetworkCall;
dns.resolve = rejectNetworkCall;
net.connect = rejectNetworkCall;
net.createConnection = rejectNetworkCall;
net.Socket.prototype.connect = rejectNetworkCall;
tls.connect = rejectNetworkCall;
global.fetch = rejectNetworkCall;

const sourceRoot = path.resolve(__dirname, '../src');
const sourceFiles = [];
const emptyWorkingDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ifr-telegram-import-')
);

function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath);
    } else if (entry.name.endsWith('.js') && entryPath !== path.join(sourceRoot, 'index.js')) {
      sourceFiles.push(entryPath);
    }
  }
}

collectSourceFiles(sourceRoot);
sourceFiles.sort();
process.chdir(emptyWorkingDirectory);

for (const sourceFile of sourceFiles) {
  require(sourceFile);
}

fs.rmSync(emptyWorkingDirectory, { recursive: true, force: true });
process.stdout.write(
  `Imported ${sourceFiles.length} Telegram modules with network access blocked.\n`
);
process.exit(0);
