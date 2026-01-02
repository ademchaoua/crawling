import os from "os";
import { Worker } from "worker_threads";
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import c from 'chalk';
import Table from 'cli-table3';
import puppeteer from 'puppeteer';
import { fileLog, fileErrorLog, consoleLog, setReadline } from './logger/index.js';
import { connectToDatabase, getSourcesCollection, getQueueCollection, closeDatabase, requeueStuckJobs } from './db/index.js';

const numCores = os.cpus().length;

const __filename = fileURLToPath(import.meta.url);


async function addNewSource(url, jobConfig) {
  const sourcesCollection = await getSourcesCollection();
  const queueCollection = await getQueueCollection();
  
  
  await sourcesCollection.updateOne(
    { url },
    { $setOnInsert: { url, category: jobConfig.category || 'general', created_at: new Date() } },
    { upsert: true }
  );

  
  await queueCollection.updateOne(
    { url },
    { $setOnInsert: { url, status: 'pending', added_at: new Date(), config: { ...jobConfig, sourceUrl: url }, retryCount: 0 } },
    { upsert: true }
  );
  consoleLog(`[INFO] URL added to queue: ${url}`);
}

function clearConsole() {
  
  process.stdout.write('\x1B[2J\x1B[0;0H');
}

async function displayDashboard() {
  const queueCollection = await getQueueCollection();
  const sourcesCollection = await getSourcesCollection();

  clearConsole();
  consoleLog("===== Crawler Dashboard =====");
  consoleLog(`Timestamp: ${new Date().toLocaleTimeString()}`);
  consoleLog("===========================");

  const total = await queueCollection.countDocuments();
  const pending = await queueCollection.countDocuments({ status: 'pending' });
  const processing = await queueCollection.countDocuments({ status: 'processing' });
  const done = await queueCollection.countDocuments({ status: 'done' });
  const failed = await queueCollection.countDocuments({ status: 'failed' });

  const overallTable = new Table({
    head: [c.cyan('Status'), c.cyan('Count')],
    colWidths: [20, 15],
  });

  overallTable.push(
    ['Total URLs', total],
    ['Pending', pending],
    ['Processing', processing],
    ['Done', c.green(done)],
    ['Failed', c.red(failed)]
  );
  consoleLog('\n--- Overall Queue Status ---');
  consoleLog(overallTable.toString());


  consoleLog("\n--- Statistics Per Source --- (Type 'add <url> <css,...>' or 'exit')");
  const sources = await sourcesCollection.find().toArray();
  if (sources.length === 0) {
    consoleLog("No sources found.");
  } else {
    const sourcesTable = new Table({
      head: [c.cyan('Source URL'), c.cyan('Pending'), c.cyan('Processing'), c.cyan('Done'), c.cyan('Failed'), c.cyan('Total')],
      colWidths: [40, 12, 12, 12, 12, 12],
    });

    for (const source of sources) {
      const sourceUrl = source.url;
      const stats = await queueCollection.aggregate([
        { $match: { 'config.sourceUrl': sourceUrl } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).toArray();
      const statsMap = stats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
      const sourceTotal = (statsMap.pending || 0) + (statsMap.processing || 0) + (statsMap.done || 0) + (statsMap.failed || 0);
      sourcesTable.push([
        sourceUrl,
        statsMap.pending || 0,
        statsMap.processing || 0,
        c.green(statsMap.done || 0),
        c.red(statsMap.failed || 0),
        sourceTotal
      ]);
    }
    consoleLog(sourcesTable.toString());
  }
  consoleLog("\n===========================");
}

async function main() {
  let browser = null;
  let isExiting = false;
  let rl = null;

  consoleLog(`Starting ${numCores} workers...`);
  fileLog(`Main process started. Initializing ${numCores} workers.`);

  try {
    
    browser = await puppeteer.launch({ headless: true });
    const browserWSEndpoint = browser.wsEndpoint();

    
    const workerURL = new URL(path.join('core', 'worker.js'), import.meta.url);

    const puppeteerWorker = new Worker(workerURL, { 
      workerData: { type: 'puppeteer', browserWSEndpoint } 
    });
    puppeteerWorker.on("message", msg => {
      if (typeof msg === 'object' && msg !== null && msg.type === 'error' && msg.message) {
        fileErrorLog(`[PuppeteerWorker]: ${msg.message}`);
      } else {
        fileLog(`[PuppeteerWorker]: ${msg}`);
      }
    });
    puppeteerWorker.on("error", err => fileErrorLog(`[PuppeteerWorker Unhandled Error]: ${err.stack}`));
    puppeteerWorker.on("exit", code => code !== 0 && fileLog(`[WARN] PuppeteerWorker stopped with code ${code}`));

    
    const fetchWorkerCount = Math.max(1, numCores - 1);
    Array.from({ length: fetchWorkerCount }, (_, idx) => {
      const worker = new Worker(workerURL, { workerData: { type: 'fetch' } });
      worker.on("message", msg => {
        if (typeof msg === 'object' && msg !== null && msg.type === 'error' && msg.message) {
          fileErrorLog(`[FetchWorker ${idx}]: ${msg.message}`);
        } else {
          fileLog(`[FetchWorker ${idx}]: ${msg}`);
        }
      });
      worker.on("error", err => fileErrorLog(`[FetchWorker ${idx} Unhandled Error]: ${err.stack}`));
      worker.on("exit", code => code !== 0 && fileLog(`[WARN] FetchWorker ${idx} stopped with code ${code}`));
    });

  await connectToDatabase();
  consoleLog("Connected to MongoDB. Ready to add new URLs.");

  
  const result = await requeueStuckJobs();
  if (result.modifiedCount > 0) {
    consoleLog(`[INFO] Re-queued ${result.modifiedCount} stuck jobs.`);
    fileLog(`Re-queued ${result.modifiedCount} jobs that were stuck in 'processing' state.`);
  }
  

  fileLog("Successfully connected to MongoDB.");
  
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  setReadline(rl);
  rl.on('line', async (line) => {
    const [command, ...args] = line.trim().split(' ');
    if (command === 'exit') {
      await gracefulShutdown();
      return;
    }
    if (command === 'add') {
      const [url, cssPathsStr] = args;
      if (!url || !cssPathsStr) {
        consoleLog('[ERROR] Invalid command. Usage: add <url> <cssPath1,cssPath2,...>');
        return;
      }
      const cssPaths = cssPathsStr.split(',').map(p => p.trim()).filter(Boolean);
      if (cssPaths.length > 0) {
        await addNewSource(url, { cssPaths });
      } else {
        consoleLog('[ERROR] You must provide at least one CSS path.');
      }
    }
  });

  const gracefulShutdown = async () => {
    if (isExiting) return;
    isExiting = true;
    consoleLog("\nGracefully shutting down... please wait.");
    fileLog("Shutdown signal received. Closing resources.");
    if (browser) {
      await browser.close();
    }
    await closeDatabase();
    consoleLog("Exited gracefully.");
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  
  while (!isExiting) {
    await displayDashboard();
    await new Promise(resolve => setTimeout(resolve, 5000)); 
  }

  } finally {
    if (!isExiting) { 
      if (browser) await browser.close();
      if (rl) rl.close();
      await closeDatabase();
      consoleLog("Exiting main process.");
      fileLog("Main process finished.");
    }
  }
}

main();
