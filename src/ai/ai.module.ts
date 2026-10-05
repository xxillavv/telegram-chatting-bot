import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { createLlmClient, LLM_CLIENT } from './llm.client';
import { SpeechService } from './speech.service';
import { VisionService } from './vision.service';

@Module({
  providers: [
    { provide: LLM_CLIENT, useFactory: createLlmClient },
    AiService,
    SpeechService,
    VisionService,
  ],
  exports: [AiService, SpeechService, VisionService],
})
export class AiModule {}
