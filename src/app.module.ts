import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { TelegrafModule } from 'nestjs-telegraf';
import 'dotenv/config'
import { ChattingBotUpdate } from './app.update';


@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TELEGRAM_BOT_TOKEN!
    })
  ],
  providers: [AppService, ChattingBotUpdate
  ],
})
export class AppModule { }
