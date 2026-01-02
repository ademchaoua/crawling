import { MongoClient } from 'mongodb';
import { config } from '../../config/index.js';

let client;

export async function connectToDatabase() {
  if (client && client.topology && client.topology.isConnected()) {
    return client;
  }
  client = new MongoClient(config.mongodb.url);
  await client.connect();
  return client;
}

export async function getDb() {
  const connectedClient = await connectToDatabase();
  return connectedClient.db(config.mongodb.dbName);
}

export async function getQueueCollection() {
  const db = await getDb();
  return db.collection(config.mongodb.collections.queue);
}

export async function getCrawledDataCollection() {
  const db = await getDb();
  return db.collection(config.mongodb.collections.crawledData);
}

export async function getSourcesCollection() {
  const db = await getDb();
  return db.collection(config.mongodb.collections.sources);
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function requeueStuckJobs() {
  const queueCollection = await getQueueCollection();
  return queueCollection.updateMany(
    { status: 'processing' },
    { $set: { status: 'pending' } }
  );
}