import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import 'dotenv/config';
import { BotModule } from './bot/bot.module';
import { BUSINESS_UPDATES } from './bot/business.types';

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TG_API_TOKEN!,
      launchOptions: {
        // Бізнес-оновлення треба замовити явно, інакше Telegram їх може не надсилати
        allowedUpdates: [
          'message',
          'callback_query',
          ...BUSINESS_UPDATES,
        ] as never,
      },
    }),
    BotModule,
  ],
})
export class AppModule {}
