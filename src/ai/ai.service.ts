import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { Session } from '../session/session.types';
import { DEFAULT_TONE, findTone } from '../tones/tones';
import {
  EMOJI_OFF,
  EMOJI_ON,
  ROLE_PROMPT,
  STYLE_RULES,
} from './prompts/base.prompt';
import { LLM_CLIENT } from './llm.client';

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

// Тире між словами виглядає «по-книжному» — люди в месенджерах так не пишуть
function stripDashes(text: string): string {
  return text
    .replace(/^\s*[—–-]\s+/gm, '')
    .replace(/\s+[—–-]\s+|\s*[—–]\s*/g, ', ')
    .replace(/,\s*([,.!?…])/g, '$1')
    .trim();
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ').trim();
}

@Injectable()
export class AiService {
  private readonly model = process.env.LLM_MODEL || 'openai/gpt-oss-120b';

  constructor(@Inject(LLM_CLIENT) private readonly client: OpenAI) {}

  async generateReply(session: Session, hint?: string): Promise<string> {
    const system = this.buildSystemPrompt(session);

    let userPrompt = this.buildDialogPrompt(session);
    if (hint) userPrompt += `\n${hint}`;
    if (session.styleEdits.length) {
      const samples = session.styleEdits
        .slice(-3)
        .map((e) => `«${e.after}»`)
        .join(', ');
      userPrompt += `\nПиши точно в моєму стилі, як мої справжні повідомлення: ${samples}.`;
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.9,
      max_completion_tokens: 2000,
      // gpt-oss — reasoning-модель; для коротких реплік вистачає мінімуму
      ...(this.model.startsWith('openai/gpt-oss') && {
        reasoning_effort: 'low' as const,
      }),
    });

    // Деякі моделі (Qwen) вставляють міркування в <think>…</think> прямо в текст
    let text = completion.choices[0]?.message?.content
      ?.replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    // Модель іноді ігнорує заборону — підчищаємо самі
    if (text) text = stripDashes(text);
    if (text && !session.emoji) text = stripEmoji(text);
    if (!text) throw new Error('LLM повернула порожню відповідь');
    return text;
  }

  // Відділяємо її нові повідомлення (після моєї останньої репліки) від попередньої переписки
  private buildDialogPrompt(session: Session): string {
    const { history } = session;
    let split = history.length;
    while (split > 0 && history[split - 1].from === 'her') split--;

    const format = (lines: Session['history']) =>
      lines
        .map((line) => `${line.from === 'her' ? 'Вона' : 'Я'}: ${line.text}`)
        .join('\n');

    const earlier = history.slice(0, split);
    const fresh = history.slice(split);

    const parts: string[] = [];
    parts.push(
      earlier.length
        ? `Попередня переписка:\n${format(earlier)}`
        : 'Це початок переписки.',
    );
    parts.push(
      `Її нові повідомлення, на які треба відповісти:\n${format(fresh)}`,
    );
    parts.push(
      'Напиши мою наступну відповідь, суворо дотримуючись обраного тону.',
    );
    return parts.join('\n\n');
  }

  private buildSystemPrompt(session: Session): string {
    const parts = [ROLE_PROMPT];

    if (session.customTone) {
      parts.push(
        `ТОН (найважливіше, дотримуйся в кожній відповіді):\n${session.customTone}`,
      );
    } else {
      const tone = findTone(session.toneKey) ?? DEFAULT_TONE;
      parts.push(
        `ТОН (найважливіше, дотримуйся в кожній відповіді): ${tone.label}\n${tone.prompt}`,
        `Приклади реплік у цьому тоні (лише для стилю, не копіюй дослівно):\n${tone.examples.map((e) => `- ${session.emoji ? e : stripEmoji(e)}`).join('\n')}`,
      );
    }

    parts.push(`${STYLE_RULES}\n- ${session.emoji ? EMOJI_ON : EMOJI_OFF}`);

    if (session.about) {
      parts.push(`Контекст про неї та їхнє спілкування:\n${session.about}`);
    }

    // Стиль — останнім: моделі сильніше зважають на кінець промпта
    if (session.styleEdits.length) {
      const edits = session.styleEdits
        .map((e) => `Було: ${e.before}\nСтало: ${e.after}`)
        .join('\n\n');
      parts.push(
        `МІЙ СТИЛЬ — НАЙВАЖЛИВІШЕ ПРАВИЛО, важливіше за тон, його приклади і загальні правила. Ось як я виправляв твої відповіді. Пиши одразу так, ніби я вже виправив: таку ж довжину, такі ж слова й сленг, таку ж пунктуацію (якщо в «Стало» нема ком і крапок — не став їх), такі ж малі/великі літери.\n\n${edits}`,
      );
    }

    return parts.join('\n\n');
  }
}
