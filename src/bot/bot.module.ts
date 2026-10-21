import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SessionModule } from '../session/session.module';
import { BotUpdate } from './bot.update';
import { BusinessHandler } from './business.handler';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AiModule, SessionModule],
  providers: [BotUpdate, ConversationService, BusinessHandler],
})
export class BotModule {}
