import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../ai/speech.service';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import { FORWARD_DELAY_MS, liveDelay, MAX_BATCH_WAIT_MS } from './batching';
import { AUTO_SEND_SECONDS } from './auto-send';
import { autoSendKeyboard, replyKeyboard } from './bot.keyboards';
import { canSendTo } from './business.types';
import { AudioMedia } from './media';

// Telegram не віддає ботам файли, більші за 20 МБ
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

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

  // Таймери автовідправки по чатах
  private readonly autoTimers = new Map<number, NodeJS.Timeout>();

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
  // При пересиланні не бачимо, що він відправив, тож вважаємо, що нашу чернетку.
  addHers(chatId: number, text: string, live: boolean) {
    const session = this.sessions.get(chatId);
    if (session.draft) {
      if (live) void this.markDraftOutdated(chatId);
      else this.sessions.addLine(chatId, { from: 'me', text: session.draft });
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
      const auto = Boolean(session.autoSend) && this.canSend(session);
      const sent = await this.bot.telegram.sendMessage(
        chatId,
        reply,
        auto ? autoSendKeyboard : replyKeyboard(this.canSend(session)),
      );
      session.draftMessageId = sent.message_id;
      if (auto) this.scheduleAutoSend(chatId, reply, sent.message_id);
    } catch (error) {
      console.error(error);
      await this.bot.telegram.sendMessage(
        chatId,
        'Не вдалося згенерувати відповідь, спробуй ще раз 🙏',
      );
    }
  }

  // Якщо за цей час він не натиснув «Стоп», не правив і вона не дописала — відправляємо самі
  private scheduleAutoSend(chatId: number, text: string, messageId: number) {
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
    }, AUTO_SEND_SECONDS * 1000);
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

    await this.bot.telegram.sendMessage(herChatId, text, extra);

    session.draft = undefined;
    session.draftMessageId = undefined;
    this.sessions.addLine(chatId, { from: 'me', text });
  }
}
