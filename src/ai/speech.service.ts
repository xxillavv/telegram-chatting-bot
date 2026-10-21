import { Inject, Injectable } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { LLM_CLIENT } from './llm.client';

@Injectable()
export class SpeechService {
  private readonly model = process.env.STT_MODEL || 'whisper-large-v3';
  // Whisper часто плутає українську з польською чи російською, тому мову задаємо явно.
  // STT_LANGUAGE= (порожнє) — автовизначення
  private readonly language = process.env.STT_LANGUAGE ?? 'uk';

  constructor(@Inject(LLM_CLIENT) private readonly client: OpenAI) {}

  async transcribe(audio: Buffer, fileName: string): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      file: await toFile(audio, fileName),
      model: this.model,
      ...(this.language && { language: this.language }),
      // Підказка зі стилем — Whisper краще ловить розмовну мову й сленг
      prompt: 'Голосове повідомлення в месенджері, розмовна мова.',
    });
    return result.text.trim();
  }
}
