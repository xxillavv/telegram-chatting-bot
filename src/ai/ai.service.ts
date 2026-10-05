import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { Session } from '../session/session.types';
import { DEFAULT_TONE, findTone } from '../tones/tones';
import {
  EMOJI_OFF,
  EMOJI_ON,
  HUMAN_RULES,
  ROLE_PROMPT,
  STYLE_RULES,
} from './prompts/base.prompt';
import { LLM_CLIENT } from './llm.client';
import { InterestAnalysis } from './interest.types';
import { INTEREST_PROMPT } from './prompts/interest.prompt';
import { FACTS_PROMPT, MAX_FACTS, MAX_MY_FACTS } from './prompts/facts.prompt';
import {
  DIALOG_EXAMPLES,
  MAX_REPLY_MESSAGES,
  MY_STYLE,
  STYLE_FORMAT,
} from './prompts/my-style.prompt';
import { formatStats } from '../stats/stats.text';
import { nowContext, plural, timeMarker } from './time';

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

// Тире між словами виглядає «по-книжному» — люди в месенджерах так не пишуть
function stripDashes(text: string): string {
  return text
    .replace(/^\s*[—–-]\s+/gm, '')
    .replace(/\s+[—–-]\s+|\s*[—–]\s*/g, ', ')
    .replace(/,\s*([,.!?…])/g, '$1')
    .trim();
}

// Модель іноді загортає відповідь у код: ```, лапки навколо рядків, коми чи дужки масиву
function stripWrapping(text: string): string {
  return text
    .replace(/```[a-z]*/gi, '')
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[[\]]$/, '')
        .replace(/['"`»“”]+,?$/, '')
        .replace(/^['"`«„“]+/, ''),
    )
    .filter(Boolean)
    .join('\n');
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ').trim();
}

// Кожен рядок — окреме повідомлення: з маленької, без крапки в кінці, як він пише
function applyStyleFormat(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let result = line.trim();
      if (STYLE_FORMAT.noTrailingPeriod) result = result.replace(/\.+$/, '');
      if (STYLE_FORMAT.lowercase) {
        result = result.charAt(0).toLocaleLowerCase('uk') + result.slice(1);
      }
      return result;
    })
    .filter(Boolean)
    .join('\n');
}

// Оклики, три крапки і «??» — типові ознаки згенерованого тексту
function stripBotPunctuation(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/!+/g, '')
        .replace(/(\.{2,}|…)/g, ' ')
        .replace(/\?{2,}/g, '?')
        .replace(/ {2,}/g, ' ')
        .replace(/\s+([,?])/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

// Фрази, які модель пише попри заборону, — рядок з ними краще викинути
const BOT_PHRASES =
  /звучить (класно|цікаво|круто|чудово)|це чудово|радий чути|розумію тебе|розумію, буває|як пройшов (твій )?день|безумовно|розкажи більше|можу послухати|я тут подумав/i;

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function normalize(text: string): string {
  return text
    .toLocaleLowerCase('uk')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

// Скільки повідомлень і слів доречно у відповідь: на «ок» не пишуть абзац
function replyBudget(fresh: Session['history']): {
  messages: number;
  hint: string;
} {
  const total = fresh.reduce((sum, line) => sum + words(line.text), 0);
  if (total <= 3) {
    return {
      messages: 1,
      hint: 'Вона написала дуже коротко. Відповідай одним коротким повідомленням до 6 слів.',
    };
  }
  if (total <= 15) {
    return {
      messages: 2,
      hint: 'Вона написала коротко. Відповідай 1–2 короткими повідомленнями, разом до 15 слів.',
    };
  }
  return {
    messages: MAX_REPLY_MESSAGES,
    hint: 'Вона написала розгорнуто. Можна 2–3 повідомлення, але кожне коротке.',
  };
}

function exampleTurns(): OpenAI.ChatCompletionMessageParam[] {
  return DIALOG_EXAMPLES.flatMap(({ her, me }) => [
    {
      role: 'user' as const,
      content: `Приклад. Її повідомлення:\n${her.map((t) => `Вона: ${t}`).join('\n')}`,
    },
    { role: 'assistant' as const, content: me.join('\n') },
  ]);
}

const QUESTIONS_COUNT = 3;

const MAX_QUOTE = 100;

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_QUOTE ? `${flat.slice(0, MAX_QUOTE)}…` : flat;
}

// prev — рядок перед першим, щоб правильно порахувати паузу
function formatLines(
  lines: Session['history'],
  prev?: Session['history'][number],
): string {
  const out: string[] = [];
  for (const line of lines) {
    const marker = timeMarker(line, prev);
    if (marker) out.push(marker);
    const who = line.from === 'her' ? 'Вона' : 'Я';
    const reply = line.replyTo
      ? ` (у відповідь на «${quote(line.replyTo)}»)`
      : '';
    out.push(`${who}${reply}: ${line.text}`);
    prev = line;
  }
  return out.join('\n');
}

function formatFacts(facts: string[]): string {
  return facts.map((fact) => `- ${fact}`).join('\n');
}

@Injectable()
export class AiService {
  private readonly model = process.env.LLM_MODEL || 'openai/gpt-oss-120b';

  constructor(@Inject(LLM_CLIENT) private readonly client: OpenAI) {}

  async generateReply(session: Session, hint?: string): Promise<string> {
    let userPrompt = this.buildDialogPrompt(session);
    if (hint) userPrompt += `\n${hint}`;
    const text = await this.complete(session, userPrompt, true);

    // Однакова фраза двічі за розмову — найпомітніша ознака бота
    const said = new Set(
      session.history
        .filter((line) => line.from === 'me')
        .slice(-30)
        .map((line) => normalize(line.text)),
    );
    const lines = text.split('\n');
    const fresh = lines.filter(
      (line) => !said.has(normalize(line)) && !BOT_PHRASES.test(line),
    );
    const { messages } = replyBudget(this.freshLines(session));
    return (fresh.length ? fresh : lines).slice(0, messages).join('\n');
  }

  // Питання, щоб розрядити паузу — з урахуванням контексту, переписки, тону і стилю
  async generateQuestions(session: Session): Promise<string[]> {
    const dialog = session.history.length
      ? `Наша переписка (останні повідомлення внизу):\n${formatLines(session.history)}`
      : 'Переписки ще нема.';
    const userPrompt = `${dialog}

У розмові незручна пауза. Придумай ${QUESTIONS_COUNT} різні питання, які я можу їй написати, щоб легко відновити розмову.
- Відкриті питання, на які хочеться відповісти розгорнуто, а не «так/ні».
- Чіпляйся за контекст про неї і за теми з переписки, якщо вони є. Не перепитуй те, що вже обговорили.
- Кожне питання в обраному тоні і моєму стилі, коротко, як у месенджері.
- Питання мають бути різними за темою.
Формат: кожне питання одним рядком (не розбивай питання на кілька повідомлень), кожне з нового рядка, без нумерації, лапок і пояснень.`;

    const text = await this.complete(session, userPrompt);
    const questions = text
      .split('\n')
      .map((line) => line.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, QUESTIONS_COUNT);
    if (!questions.length) throw new Error('LLM не повернула питань');
    return questions;
  }

  async analyzeInterest(session: Session): Promise<InterestAnalysis> {
    const parts = [
      formatStats(session.stats),
      `Переписка (останні повідомлення внизу):\n${formatLines(session.history)}`,
      nowContext(session.history),
    ];
    if (session.facts?.length) {
      parts.unshift(`Що відомо про неї:\n${formatFacts(session.facts)}`);
    }
    if (session.about) parts.unshift(`Контекст про неї: ${session.about}`);

    const data = await this.completeJson<Partial<InterestAnalysis>>(
      INTEREST_PROMPT,
      parts.join('\n\n'),
      'medium',
    );
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string').slice(0, 3)
        : [];

    return {
      interest: Math.min(
        100,
        Math.max(0, Math.round(Number(data.interest) || 0)),
      ),
      summary: String(data.summary ?? '').trim(),
      positive: list(data.positive).map(stripDashes),
      negative: list(data.negative).map(stripDashes),
      advice: stripDashes(String(data.advice ?? '')),
    };
  }

  // Оновлені списки фактів про неї і про нього з урахуванням свіжих повідомлень
  async extractFacts(
    session: Session,
    lines: Session['history'],
  ): Promise<{ her: string[]; me: string[] }> {
    const known = (facts?: string[]) =>
      facts?.length ? formatFacts(facts) : 'Поки нічого.';
    const parts = [
      `Відомі факти про неї:\n${known(session.facts)}`,
      `Відомі факти про нього:\n${known(session.myFacts)}`,
      `Свіжа переписка:\n${formatLines(lines)}`,
    ];
    if (session.aboutMe) {
      parts.unshift(`Що він сам розповів про себе: ${session.aboutMe}`);
    }
    if (session.about) {
      parts.unshift(`Що він сам розповів про неї: ${session.about}`);
    }

    const data = await this.completeJson<{ her?: unknown; me?: unknown }>(
      FACTS_PROMPT,
      parts.join('\n\n'),
      'low',
    );
    if (!Array.isArray(data.her)) throw new Error('LLM не повернула фактів');
    const clean = (value: unknown, max: number) =>
      (Array.isArray(value) ? value : [])
        .filter((f): f is string => typeof f === 'string')
        .map((f) => stripDashes(f.trim()))
        .filter(Boolean)
        .slice(0, max);
    return {
      her: clean(data.her, MAX_FACTS),
      // Не повернула список про нього — лишаємо старий, а не стираємо
      me: Array.isArray(data.me)
        ? clean(data.me, MAX_MY_FACTS)
        : (session.myFacts ?? []),
    };
  }

  private async completeJson<T>(
    system: string,
    user: string,
    effort: 'low' | 'medium',
  ): Promise<T> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_completion_tokens: 3000,
      response_format: { type: 'json_object' },
      ...(this.model.startsWith('openai/gpt-oss') && {
        reasoning_effort: effort,
      }),
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(json) as T;
  }

  private async complete(
    session: Session,
    userPrompt: string,
    withExamples = false,
  ): Promise<string> {
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
        { role: 'system', content: this.buildSystemPrompt(session) },
        ...(withExamples ? exampleTurns() : []),
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      // Ліміт Groq рахує й зарезервовані токени відповіді — більше не ставити
      max_completion_tokens: 2000,
      // gpt-oss — reasoning-модель; на low пише криву українську і не розуміє сленг («пари»)
      ...(this.model.startsWith('openai/gpt-oss') && {
        reasoning_effort: 'medium' as const,
      }),
    });

    // Деякі моделі (Qwen) вставляють міркування в <think>…</think> прямо в текст
    let text = completion.choices[0]?.message?.content
      ?.replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    // Модель іноді ігнорує заборону — підчищаємо самі
    if (text) text = stripWrapping(text);
    if (text) text = stripDashes(text);
    if (text) text = stripBotPunctuation(text);
    if (text && !session.emoji) text = stripEmoji(text);
    if (text) text = applyStyleFormat(text);
    if (!text) throw new Error('LLM повернула порожню відповідь');
    return text;
  }

  // Її повідомлення після моєї останньої репліки
  private freshLines(session: Session): Session['history'] {
    const { history } = session;
    let split = history.length;
    while (split > 0 && history[split - 1].from === 'her') split--;
    return history.slice(split);
  }

  // Відділяємо її нові повідомлення (після моєї останньої репліки) від попередньої переписки
  private buildDialogPrompt(session: Session): string {
    const fresh = this.freshLines(session);
    const earlier = session.history.slice(
      0,
      session.history.length - fresh.length,
    );

    const parts: string[] = [];
    parts.push(
      earlier.length
        ? `Попередня переписка:\n${formatLines(earlier)}`
        : 'Це початок переписки.',
    );
    parts.push(
      `Її нові повідомлення, на які треба відповісти:\n${formatLines(fresh, earlier.at(-1))}`,
    );
    if (fresh.length > 1) {
      parts.push(
        `Вона написала ${fresh.length} ${plural(fresh.length, 'повідомлення', 'повідомлення', 'повідомлень')} підряд. Прочитай їх усі як одну думку і відповідай на все разом, а не лише на останнє:
- Якщо в них кілька питань, коротко дай відповідь на кожне, жодне не пропускай.
- Якщо вона чимось поділилась (новина, емоція, історія), а потім спитала, спершу зреагуй на те, чим поділилась, потім відповідай.
- Якщо вона сама себе виправила чи уточнила, відповідай на остаточний варіант.`,
      );
    }
    parts.push(replyBudget(fresh).hint);
    parts.push(
      'Напиши мою наступну відповідь, суворо дотримуючись обраного тону. Перечитай її очима дівчини: якщо звучить як чат-бот чи надто старанно, спрости.',
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
    parts.push(HUMAN_RULES);
    parts.push(
      `ЧАС: ${nowContext(session.history)} У переписці в дужках позначено, коли писали і скільки минуло між повідомленнями. Зважай на час доби (не бажай доброго ранку ввечері) і на паузи: після довгої перерви не продовжуй стару тему так, ніби її щойно обговорювали.`,
    );
    parts.push(MY_STYLE);

    const context = [
      session.linked && `Її ім'я в Telegram: ${session.linked.name}`,
      session.about,
      session.facts?.length &&
        `Що я про неї знаю з переписки (використовуй природно, коли до речі, не перелічуй і не перепитуй):\n${formatFacts(session.facts)}`,
    ].filter(Boolean);
    if (context.length) {
      parts.push(
        `Контекст про неї та їхнє спілкування:\n${context.join('\n')}`,
      );
    }

    const aboutMe = [
      session.aboutMe,
      session.myFacts?.length && formatFacts(session.myFacts),
    ].filter(Boolean);
    parts.push(
      aboutMe.length
        ? `ФАКТИ ПРО МЕНЕ (спирайся на них, коли вона питає про мене):\n${aboutMe.join('\n')}\nЧого тут нема, не вигадуй: відповідай ухильно, жартом або зустрічним питанням.`
        : 'Про мене майже нічого не відомо. Якщо вона питає про мене щось конкретне (робота, місто, плани), не вигадуй: відповідай ухильно, жартом або зустрічним питанням.',
    );

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
