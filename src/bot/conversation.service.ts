import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../ai/speech.service';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import { FORWARD_DELAY_MS, liveDelay, MAX_BATCH_WAIT_MS } from './batching';
import { replyKeyboard } from './bot.keyboards';
import { AudioMedia } from './media';

// Telegram не віддає ботам файли, більші за 20 МБ
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Спільна логіка розмови — для пересланих повідомлень і для підключеного чату (Telegram Business)
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

  canSend(session: Session): boolean {
    return Boolean(
      session.business?.enabled && session.business.canReply && session.linked,
    );
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
  // При пересиланні не бачимо, що він відправив, тож вважаємо, що нашу чернетку.
  addHers(chatId: number, text: string, live: boolean) {
    const session = this.sessions.get(chatId);
    if (session.draft) {
      if (live) void this.markDraftOutdated(chatId);
      else this.sessions.addLine(chatId, { from: 'me', text: session.draft });
    }
    session.draft = undefined;
    session.draftMessageId = undefined;
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

    let delay = live ? liveDelay(text) : FORWARD_DELAY_MS;
    if (live)
      delay = Math.min(delay, Math.max(0, startedAt + MAX_BATCH_WAIT_MS - now));

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

  private async markDraftOutdated(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session.draftMessageId || !session.draft) return;
    try {
      await this.bot.telegram.editMessageText(
        chatId,
        session.draftMessageId,
        undefined,
        `⏳ застаріло, вона дописала\n\n${session.draft}`,
      );
    } catch {
      // Повідомлення могли видалити — не страшно
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

    const generation = this.bumpGeneration(chatId);
    await this.bot.telegram.sendChatAction(chatId, 'typing');
    try {
      const reply = await this.ai.generateReply(session, hint);
      // Поки модель думала, вона дописала — цей варіант уже не про те
      if (this.generations.get(chatId) !== generation) return;
      session.draft = reply;
      const sent = await this.bot.telegram.sendMessage(
        chatId,
        reply,
        replyKeyboard(this.canSend(session)),
      );
      session.draftMessageId = sent.message_id;
    } catch (error) {
      console.error(error);
      await this.bot.telegram.sendMessage(
        chatId,
        'Не вдалося згенерувати відповідь, спробуй ще раз 🙏',
      );
    }
  }

  // Відправка їй від його імені через Telegram Business — з «друкує…», щоб виглядало природно
  async sendToHer(chatId: number, text: string) {
    const session = this.sessions.get(chatId);
    if (!this.canSend(session)) throw new Error('Чат не підключено');
    const { connectionId } = session.business!;
    const herChatId = session.linked!.chatId;
    // Telegraf 4.16 не знає business_connection_id, але передає extra в API як є
    const extra = { business_connection_id: connectionId } as object;

    await this.bot.telegram.sendChatAction(herChatId, 'typing', extra);
    await sleep(Math.min(1500 + text.length * 50, 5000));
    await this.bot.telegram.sendMessage(herChatId, text, extra);

    session.draft = undefined;
    session.draftMessageId = undefined;
    this.sessions.addLine(chatId, { from: 'me', text });
  }
}
