import { parentPort, workerData } from "worker_threads";
import { htmlProcesser, getHtmlPage, extractLinks, PuppeteerRequiredError } from "./processer.js";
import puppeteer from 'puppeteer';
import { config } from '../../config/index.js';
import { connectToDatabase, getQueueCollection, getCrawledDataCollection, closeDatabase } from '../db/index.js';
import { fileLog, fileErrorLog } from '../logger/index.js';

async function processUrl(browser, job) {
  const queueCollection = await getQueueCollection();
  const crawledDataCollection = await getCrawledDataCollection();

  try {
    // تحديث حالة الرابط إلى "processing"
    fileLog(`Processing URL: ${job.url}`);

    const html = await getHtmlPage(browser, job.url);

    // --- START: New Link Extraction Logic ---
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
              config: job.config, // Propagate config to new links
              retryCount: 0 // Initialize retry count for new links
            } 
          },
          upsert: true
        }
      }));
      await queueCollection.bulkWrite(operations, { ordered: false });
      fileLog(`Found and queued ${operations.length} new links from ${job.url}`);
    }
    // --- END: New Link Extraction Logic ---

    // يمكنك استخدام `htmlProcesser` أو أي دالة أخرى لاستخلاص البيانات
    // هنا نستخدم دالة `htmlProcesser` من ملف `processor.js`
    if (!job.config || !job.config.cssPaths) {
      throw new Error(`Job for ${job.url} is missing configuration (cssPaths).`);
    }

    // استخدام الإعدادات المرفقة مع المهمة
    const article = await htmlProcesser(html, job.config.cssPaths);

    if (article && article.contents) {
      // حفظ البيانات في `crawled_data`
      // استخدام `updateOne` مع `upsert` يضمن عدم تكرار الرابط
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

      // تحديث حالة الرابط إلى "done"
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'done' } }
      );
      fileLog(`Successfully crawled and saved: ${job.url}`);
    } else {
      // إذا لم يتم العثور على محتوى، يتم تحديث الحالة إلى "failed"
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

    // الاقتراح: إعادة المحاولة للأخطاء المؤقتة
    const isTemporaryError = err.message.includes('fetch failed'); // يمكنك إضافة المزيد من أنواع الأخطاء هنا

    if (err instanceof PuppeteerRequiredError) {
      // إذا كانت الصفحة تتطلب Puppeteer، قم بتحديثها وإعادتها إلى قائمة الانتظار للعامل المخصص
      await queueCollection.updateOne({ _id: job._id }, { $set: { status: 'pending', requires_puppeteer: true } });
      fileLog(`Marked ${job.url} as requiring Puppeteer.`);
      return;
    }

    if (isTemporaryError && currentRetries < config.crawler.maxRetries) {
      // إعادة المحاولة: أعد الحالة إلى pending وزد العداد
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'pending' }, $inc: { retryCount: 1 } }
      );
      fileLog(`Re-queuing ${job.url} for another attempt.`);
    } else {
      // فشل دائم: حدث الحالة إلى failed
      await queueCollection.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', error_message: err.message, error_stack: err.stack } }
      );

      // --- START: Bad Source Pruning Logic ---
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
      // --- END: Bad Source Pruning Logic ---
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
      // --- التحسين: استخدام findOneAndUpdate لسحب المهام بشكل آمن ---
      const promises = Array.from({ length: config.crawler.concurrency }, async () => {
        let query;
        // بناء الاستعلام الصحيح لكل نوع من العمال
        if (workerType === 'puppeteer') {
          query = { status: 'pending', requires_puppeteer: true };
        } else { // fetch worker
          query = { status: 'pending', requires_puppeteer: { $ne: true } };
        }

        const job = await queueCollection.findOneAndUpdate(query,
          { $set: { status: 'processing' } },
          { returnDocument: 'after' }
        );

        fileLog(`Worker type '${workerType}' checked for a job. Found: ${job ? job.url : 'None'}`);
        if (job) {
          // عمال Fetch لا يمررون المتصفح
          await processUrl(workerType === 'puppeteer' ? browser : null, job);
        }
      });

      await Promise.allSettled(promises);

      // إذا لم يتم العثور على أي مهام، انتظر قليلاً
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
      // الاقتراح: أضف تأخيرًا بسيطًا بين كل دفعة من الطلبات لتقليل الضغط
      await sleep(config.crawler.delay); // تأخير لمدة ثانية واحدة
    }
  } finally {
    if (browser && browser.isConnected()) {
      await browser.disconnect();
    }
    await closeDatabase();
  }
}

run();