import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SessionModule } from '../session/session.module';
import { BotUpdate } from './bot.update';

@Module({
  imports: [AiModule, SessionModule],
  providers: [BotUpdate],
})
export class BotModule {}
