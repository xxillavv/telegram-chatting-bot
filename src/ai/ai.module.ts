import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { createLlmClient, LLM_CLIENT } from './llm.client';
import { SpeechService } from './speech.service';

@Module({
  providers: [
    { provide: LLM_CLIENT, useFactory: createLlmClient },
    AiService,
    SpeechService,
  ],
  exports: [AiService, SpeechService],
})
export class AiModule {}
