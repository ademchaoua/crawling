import { workerData } from "worker_threads";
import { htmlProcesser, getHtmlPage, extractLinks, PuppeteerRequiredError } from "./processer.js";
import puppeteer from 'puppeteer';
import { config } from '../../config/index.js';
import { connectToDatabase, getQueueCollection, getCrawledDataCollection, closeDatabase } from '../db/index.js';
import { fileLog, fileErrorLog } from '../logger/index.js';

async function processUrl(browser, job) {
  const queueCollection = await getQueueCollection();
  const crawledDataCollection = await getCrawledDataCollection();

  try {
    
    fileLog(`Processing URL: ${job.url}`);

    const html = await getHtmlPage(browser, job.url);

    
    const baseUrl = new URL(job.url).origin;
    const newLinks = extractLinks(html, baseUrl);

    if (newLinks.length > 0) {
      const operations = newLinks.map(link => ({
        updateOne: {
          filter: { url: link },
          update: { 
            $setOnInsert: { 
              url: link, 
              status: 'pending', 
              added_at: new Date(), 
              config: job.config, 
              retryCount: 0 
            } 
          },
          upsert: true
        }
      }));
      await queueCollection.bulkWrite(operations, { ordered: false });
      fileLog(`Found and queued ${operations.length} new links from ${job.url}`);
    }
    

    
    
    if (!job.config || !job.config.cssPaths) {
      throw new Error(`Job for ${job.url} is missing configuration (cssPaths).`);
    }

    
    const article = await htmlProcesser(html, job.config.cssPaths);

    if (article && article.contents) {
      
      
      await crawledDataCollection.updateOne(
        { url: job.url },
        {
          $set: {
            title: article.title,
            content: article.contents,
            description: article.description,
            image: article.image,
            author: article.author,
            publishedDate: article.publishedDate,
            crawled_at: new Date()
          }
        },
        { upsert: true }
      );

      
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'done' } }
      );
      fileLog(`Successfully crawled and saved: ${job.url}`);
    } else {
      
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', error_message: 'No content extracted. CSS paths might be incorrect.' } }
      );
      fileLog(`Failed to extract content from: ${job.url}. CSS paths [${job.config.cssPaths.join(', ')}] might not match the page structure.`);
    }
  } catch (err) {
    const currentRetries = job.retryCount ?? 0;
    fileLog(`Error processing ${job.url} (Attempt ${currentRetries + 1}). Message: ${err.message}`);
    fileErrorLog(`Error processing ${job.url} (Attempt ${currentRetries + 1}). Stack: ${err.stack}`);

    
    const isTemporaryError = err.message.includes('fetch failed'); 

    if (err instanceof PuppeteerRequiredError) {
      
      await queueCollection.updateOne({ _id: job._id }, { $set: { status: 'pending', requires_puppeteer: true } });
      fileLog(`Marked ${job.url} as requiring Puppeteer.`);
      return;
    }

    if (isTemporaryError && currentRetries < config.crawler.maxRetries) {
      
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'pending' }, $inc: { retryCount: 1 } }
      );
      fileLog(`Re-queuing ${job.url} for another attempt.`);
    } else {
      
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', error_message: err.message, error_stack: err.stack } }
      );

      
      if (config.crawler.pruning.enabled && job.config.sourceUrl) {
        const sourceUrl = job.config.sourceUrl;
        const failedCount = await queueCollection.countDocuments({ 'config.sourceUrl': sourceUrl, status: 'failed' });

        if (failedCount >= config.crawler.pruning.failureThreshold) {
          const doneCount = await queueCollection.countDocuments({ 'config.sourceUrl': sourceUrl, status: 'done' });

          if (doneCount <= config.crawler.pruning.doneCountThreshold) {
            fileLog(`[PRUNING] Source ${sourceUrl} has ${failedCount} failures and only ${doneCount} successes. Deleting all pending jobs from this source.`);
            const deleteResult = await queueCollection.deleteMany({ 'config.sourceUrl': sourceUrl, status: 'pending' });
            if (deleteResult.deletedCount > 0) {
              fileLog(`[PRUNING] Deleted ${deleteResult.deletedCount} pending jobs from bad source: ${sourceUrl}`);
            }
          }
        }
      }
      
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  let browser = null;

  try {
    await connectToDatabase();
    
    const workerType = workerData.type;

    if (workerType === 'puppeteer') {
      browser = await puppeteer.connect({ browserWSEndpoint: workerData.browserWSEndpoint });
    }

    const queueCollection = await getQueueCollection();

    while (true) {
      
      const promises = Array.from({ length: config.crawler.concurrency }, async () => {
        let query;
        
        if (workerType === 'puppeteer') {
          query = { status: 'pending', requires_puppeteer: true };
        } else { 
          query = { status: 'pending', requires_puppeteer: { $ne: true } };
        }

        const job = await queueCollection.findOneAndUpdate(query,
          { $set: { status: 'processing' } },
          { returnDocument: 'after' }
        );

        fileLog(`Worker type '${workerType}' checked for a job. Found: ${job ? job.url : 'None'}`);
        if (job) {
          
          await processUrl(workerType === 'puppeteer' ? browser : null, job);
        }
      });

      await Promise.allSettled(promises);

      
      let countQuery;
      if (workerType === 'puppeteer') {
        countQuery = { status: 'pending', requires_puppeteer: true };
      } else {
        countQuery = { status: 'pending', requires_puppeteer: { $ne: true } };
      }
      const pendingCount = await queueCollection.countDocuments(countQuery);
      if (pendingCount === 0) {
        fileLog(`No jobs found for type '${workerType}'. Sleeping...`);
        await sleep(config.crawler.sleep);
      }
      
      await sleep(config.crawler.delay); 
    }
  } finally {
    if (browser && browser.isConnected()) {
      await browser.disconnect();
    }
    await closeDatabase();
  }
}

run();
