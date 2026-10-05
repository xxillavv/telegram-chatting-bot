import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../ai/speech.service';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import {
  AUTO_BATCH_FACTOR,
  FORWARD_DELAY_MS,
  liveDelay,
  MAX_BATCH_WAIT_MS,
} from './batching';
import { AUTO_SEND_QUIET_SECONDS, AUTO_SEND_SECONDS } from './auto-send';
import { autoSendKeyboard, replyKeyboard } from './bot.keyboards';
import { canSendTo } from './business.types';
import { AudioMedia } from './media';

// Telegram не віддає ботам файли, більші за 20 МБ
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
// Факти про неї оновлюємо раз на стільки нових повідомлень — не на кожне, щоб не палити ліміти
const FACTS_EVERY = 10;
// Трохи старіших рядків для контексту до нових
const FACTS_CONTEXT_LINES = 4;

// Спільна логіка розмови — для пересланих повідомлень і для підключеного чату (Telegram Business)
function splitMessages(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

@Injectable()
export class ConversationService {
  // Її повідомлення, що назбирались, поки чекаємо кінця пачки
  private readonly batches = new Map<
    number,
    { timer: NodeJS.Timeout; startedAt: number; texts: string[]; live: boolean }
  >();
  // Номер останньої генерації: якщо поки модель думала, прийшло нове — результат уже застарів
  private readonly generations = new Map<number, number>();

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly sessions: SessionService,
    private readonly ai: AiService,
    private readonly speech: SpeechService,
  ) {}

  // Таймери автовідправки по чатах
  private readonly autoTimers = new Map<number, NodeJS.Timeout>();
  // Коли вона писала востаннє — автовідправка чекає тиші
  private readonly lastHerAt = new Map<number, number>();
  // Коли з'явилась поточна чернетка — щоб відрізнити її відповідь від продовження думки
  private readonly draftAt = new Map<number, number>();
  // Чати, для яких зараз оновлюються факти
  private readonly factsInProgress = new Set<number>();

  canSend(session: Session): boolean {
    return canSendTo(session);
  }

  cancelAutoSend(chatId: number) {
    clearTimeout(this.autoTimers.get(chatId));
    this.autoTimers.delete(chatId);
  }

  async transcribe(media: AudioMedia): Promise<string> {
    if (media.size && media.size > MAX_AUDIO_BYTES) {
      throw new Error('Аудіо більше 20 МБ');
    }
    const url = await this.bot.telegram.getFileLink(media.fileId);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Telegram file: ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    return this.speech.transcribe(audio, media.fileName);
  }

  // Його власне повідомлення — справжнє, тож заодно вчимося на ньому стилю
  addMine(chatId: number, text: string) {
    const session = this.sessions.get(chatId);
    if (session.draft) {
      this.sessions.addStyleEdit(chatId, {
        before: session.draft,
        after: text,
      });
    }
    session.draft = undefined;
    this.sessions.addLine(chatId, { from: 'me', text });
  }

  // live: повідомлення з підключеного чату (Telegram Business), де ми бачимо все самі.
  // При пересиланні не бачимо, що він відправив, тож вважаємо, що нашу чернетку, —
  // якщо тільки її повідомлення не написане раніше за чернетку (writtenAt — дата оригіналу).
  addHers(chatId: number, text: string, live: boolean, writtenAt?: number) {
    const session = this.sessions.get(chatId);
    this.lastHerAt.set(chatId, Date.now());
    if (session.draft) {
      const continuation =
        live ||
        (writtenAt !== undefined &&
          writtenAt <= (this.draftAt.get(chatId) ?? 0));
      // Вона дописує думку — стара чернетка вже не про те, нова прийде на все разом
      if (continuation) void this.deleteDraftMessage(chatId);
      else this.addMyLines(chatId, session.draft);
    }
    session.draft = undefined;
    session.draftMessageId = undefined;
    this.cancelAutoSend(chatId);
    this.bumpGeneration(chatId);
    this.sessions.addLine(chatId, { from: 'her', text });
    this.scheduleReply(chatId, text, live);
  }

  // Вона пише кількома короткими повідомленнями — чекаємо, поки допише думку
  private scheduleReply(chatId: number, text: string, live: boolean) {
    const now = Date.now();
    const batch = this.batches.get(chatId);
    clearTimeout(batch?.timer);
    const startedAt = batch?.startedAt ?? now;

    let delay = FORWARD_DELAY_MS;
    if (live) {
      const session = this.sessions.get(chatId);
      const factor =
        session.autoSend && this.canSend(session) ? AUTO_BATCH_FACTOR : 1;
      const deadline = startedAt + MAX_BATCH_WAIT_MS * factor;
      delay = Math.min(liveDelay(text) * factor, Math.max(0, deadline - now));
    }

    const timer = setTimeout(() => void this.flushBatch(chatId), delay);
    this.batches.set(chatId, {
      timer,
      startedAt,
      texts: [...(batch?.texts ?? []), text],
      live: live || Boolean(batch?.live),
    });
  }

  private async flushBatch(chatId: number) {
    const batch = this.batches.get(chatId);
    this.batches.delete(chatId);
    if (!batch) return;

    // Одне зведене сповіщення замість окремого на кожен шматок
    if (batch.live) {
      const name = this.sessions.get(chatId).linked?.name ?? 'Вона';
      await this.bot.telegram.sendMessage(
        chatId,
        `💬 ${name}:\n${batch.texts.join('\n')}`,
      );
    }
    await this.generate(chatId);
  }

  private bumpGeneration(chatId: number): number {
    const next = (this.generations.get(chatId) ?? 0) + 1;
    this.generations.set(chatId, next);
    return next;
  }

  // Щоб у чаті не копились застарілі варіанти — лишається один, актуальний
  private async deleteDraftMessage(chatId: number) {
    const { draftMessageId } = this.sessions.get(chatId);
    if (!draftMessageId) return;
    try {
      await this.bot.telegram.deleteMessage(chatId, draftMessageId);
    } catch {
      // Повідомлення могли вже видалити — не страшно
    }
  }

  // Відправляти можна лише актуальний варіант
  isCurrentDraft(chatId: number, text: string): boolean {
    return this.sessions.get(chatId).draft === text;
  }

  async generate(chatId: number, hint?: string) {
    const session = this.sessions.get(chatId);
    if (!session.history.some((line) => line.from === 'her')) {
      await this.bot.telegram.sendMessage(
        chatId,
        'Спершу потрібне її повідомлення 🙂',
      );
      return;
    }

    void this.refreshFacts(chatId);
    const generation = this.bumpGeneration(chatId);
    await this.bot.telegram.sendChatAction(chatId, 'typing');
    try {
      const reply = await this.ai.generateReply(session, hint);
      // Поки модель думала, вона дописала — цей варіант уже не про те
      if (this.generations.get(chatId) !== generation) return;
      session.draft = reply;
      this.draftAt.set(chatId, Date.now());
      const auto = Boolean(session.autoSend) && this.canSend(session);
      const autoDelay = this.autoSendDelay(chatId);
      const sent = await this.bot.telegram.sendMessage(
        chatId,
        reply,
        auto
          ? autoSendKeyboard(Math.round(autoDelay / 1000))
          : replyKeyboard(this.canSend(session)),
      );
      session.draftMessageId = sent.message_id;
      if (auto)
        this.scheduleAutoSend(chatId, reply, sent.message_id, autoDelay);
    } catch (error) {
      console.error(error);
      await this.bot.telegram.sendMessage(
        chatId,
        'Не вдалося згенерувати відповідь, спробуй ще раз 🙏',
      );
    }
  }

  // У фоні: відповідь не чекає, нові факти підхопить уже наступна
  private async refreshFacts(chatId: number) {
    const session = this.sessions.get(chatId);
    const pending = this.sessions.factsPending(session);
    if (pending < FACTS_EVERY || this.factsInProgress.has(chatId)) return;

    this.factsInProgress.add(chatId);
    try {
      const lines = session.history.slice(-(pending + FACTS_CONTEXT_LINES));
      session.facts = await this.ai.extractFacts(session, lines);
      // Поки модель думала, могли прийти нові — їх розберемо наступного разу
      session.factsPending = Math.max(
        0,
        this.sessions.factsPending(session) - pending,
      );
    } catch (error) {
      console.error('Не вдалося оновити факти', error);
    } finally {
      this.factsInProgress.delete(chatId);
    }
  }

  // Не менше вікна на «Стоп» і не раніше, ніж вона помовчить
  private autoSendDelay(chatId: number): number {
    const quietUntil =
      (this.lastHerAt.get(chatId) ?? 0) + AUTO_SEND_QUIET_SECONDS * 1000;
    return Math.max(AUTO_SEND_SECONDS * 1000, quietUntil - Date.now());
  }

  // Якщо за цей час він не натиснув «Стоп», не правив і вона не дописала — відправляємо самі
  private scheduleAutoSend(
    chatId: number,
    text: string,
    messageId: number,
    delay: number,
  ) {
    this.cancelAutoSend(chatId);
    const timer = setTimeout(() => {
      this.autoTimers.delete(chatId);
      void (async () => {
        const session = this.sessions.get(chatId);
        if (!session.autoSend || session.draft !== text) return;
        try {
          await this.sendToHer(chatId, text);
          await this.bot.telegram.editMessageText(
            chatId,
            messageId,
            undefined,
            `🤖 Відправлено автоматично\n\n${text}`,
          );
        } catch (error) {
          console.error(error);
          await this.bot.telegram.sendMessage(
            chatId,
            'Автовідправка не вдалась 🙏 Відправ вручну або перевір дозволи чат-бота.',
          );
        }
      })();
    }, delay);
    this.autoTimers.set(chatId, timer);
  }

  // Відправка їй від його імені через Telegram Business — одразу, без затримки
  async sendToHer(chatId: number, text: string) {
    const session = this.sessions.get(chatId);
    if (!this.canSend(session)) throw new Error('Чат не підключено');
    this.cancelAutoSend(chatId);
    const { connectionId } = session.business!;
    const herChatId = session.linked!.chatId;
    // Telegraf 4.16 не знає business_connection_id, але передає extra в API як є
    const extra = { business_connection_id: connectionId } as object;

    // Кожен рядок — окреме повідомлення, як він і пише
    for (const line of splitMessages(text)) {
      await this.bot.telegram.sendMessage(herChatId, line, extra);
    }

    session.draft = undefined;
    session.draftMessageId = undefined;
    this.addMyLines(chatId, text);
  }

  private addMyLines(chatId: number, text: string) {
    for (const line of splitMessages(text)) {
      this.sessions.addLine(chatId, { from: 'me', text: line });
    }
  }
}
