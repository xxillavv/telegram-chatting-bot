import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import 'dotenv/config';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TG_API_TOKEN!,
    }),
    BotModule,
  ],
})
export class AppModule {}
