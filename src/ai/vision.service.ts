import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { LLM_CLIENT } from './llm.client';

const PROMPT = (kind: string) =>
  `Це ${kind} з переписки в месенджері. Опиши українською одним коротким реченням (до 20 слів), що на ньому, щоб співрозмовник міг природно відреагувати: хто чи що зображено, настрій, що відбувається. Якщо є напис, процитуй його. Для стікера чи гіфки головне, яку емоцію чи реакцію він передає. Без вступів на кшталт «на зображенні».`;

// Groq-модель, яка бачить картинки (безплатно): описує фото й стікери текстом для основної моделі
@Injectable()
export class VisionService {
  private readonly model = process.env.VISION_MODEL || 'qwen/qwen3.8-27b';

  constructor(@Inject(LLM_CLIENT) private readonly client: OpenAI) {}

  async describe(image: Buffer, mime: string, kind: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT(kind) },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mime};base64,${image.toString('base64')}`,
              },
            },
          ],
        },
      ],
      temperature: 0.3,
      max_completion_tokens: 1500,
    });
    const text = completion.choices[0]?.message?.content
      ?.replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) throw new Error('Vision-модель повернула порожній опис');
    return text;
  }
}
