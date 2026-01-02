import fs from 'fs';
import readline from 'readline';
import { config } from '../../config/index.js';
import path from 'path';

const logDir = path.dirname(config.logging.logFile);

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logStream = fs.createWriteStream(config.logging.logFile, { flags: 'a' });
const errorLogStream = fs.createWriteStream(config.logging.errorLogFile, { flags: 'a' });

let rl; 

export function setReadline(readlineInterface) {
  rl = readlineInterface;
}


export function fileLog(message) {
  const timestamp = new Date().toISOString();
  logStream.write(`[${timestamp}] ${message}\n`);
}


export function fileErrorLog(message) {
  const timestamp = new Date().toISOString();
  errorLogStream.write(`[${timestamp}] ${message}\n`);
}


export function consoleLog(message) {
  if (rl) {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 1);
    console.log(message);
    rl.prompt(true);
  } else {
    console.log(message);
  }
}