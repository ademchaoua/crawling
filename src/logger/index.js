import fs from 'fs';
import readline from 'readline';
import { config } from '../../config/index.js';

const logStream = fs.createWriteStream(config.logging.logFile, { flags: 'a' });
const errorLogStream = fs.createWriteStream(config.logging.errorLogFile, { flags: 'a' });

let rl; // سيتم تعريف الواجهة لاحقًا وتكون متاحة في النطاق العام

export function setReadline(readlineInterface) {
  rl = readlineInterface;
}

/**
 * دالة لكتابة السجلات في ملف.
 * @param {string} message - الرسالة المراد تسجيلها.
 */
export function fileLog(message) {
  const timestamp = new Date().toISOString();
  logStream.write(`[${timestamp}] ${message}\n`);
}

/**
 * دالة لكتابة سجلات الأخطاء في ملف.
 * @param {string} message - الرسالة المراد تسجيلها.
 */
export function fileErrorLog(message) {
  const timestamp = new Date().toISOString();
  errorLogStream.write(`[${timestamp}] ${message}\n`);
}

/**
 * دالة لعرض الرسائل في الطرفية (console) وتجنب التداخل مع واجهة الإدخال.
 * @param {string} message - الرسالة المراد تسجيلها.
 */
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
