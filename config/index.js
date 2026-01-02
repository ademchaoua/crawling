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
    delay: 1000,
    sleep: 5000,
    pruning: {
      enabled: true,
      
      failureThreshold: 500,
      
      doneCountThreshold: 0,
    }
  },
  logging: {
    logFile: './src/logs/crawler.log',
    errorLogFile: './src/logs/crawler-errors.log',
  },
};