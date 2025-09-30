export const config = {
  mongodb: {
    url: 'mongodb://localhost:27017',
    dbName: 'crawler_db',
    collections: {
      queue: 'queue',
      crawledData: 'crawled_data',
      sources: 'sources',
    },
  },
  crawler: {
    concurrency: 5,
    maxRetries: 3,
    delay: 1000, // ms between batches
    sleep: 5000, // ms to wait when queue is empty
    pruning: {
      enabled: true,
      // Prune a source if it has this many failures and zero successful scrapes.
      failureThreshold: 500,
      // The 'done' count must be less than or equal to this to trigger pruning.
      doneCountThreshold: 0,
    }
  },
  logging: {
    logFile: 'crawler.log',
    errorLogFile: 'crawler-errors.log',
  },
};
