import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';

export const MONGO_DB = Symbol('MONGO_DB');

const mongoClientProvider = {
  provide: MongoClient,
  useFactory: async () => {
    const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017';
    return MongoClient.connect(url);
  },
};

const mongoDbProvider = {
  provide: MONGO_DB,
  inject: [MongoClient],
  useFactory: (client: MongoClient): Db =>
    client.db(process.env.MONGO_DB ?? 'telegram-chatting-bot'),
};

@Global()
@Module({
  providers: [mongoClientProvider, mongoDbProvider],
  exports: [MONGO_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(MongoClient) private readonly client: MongoClient) {}

  async onApplicationShutdown() {
    await this.client.close();
  }
}
