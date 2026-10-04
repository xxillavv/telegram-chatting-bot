import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../ai/speech.service';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import { BATCH_DELAY_MS } from './bot.constants';
import { replyKeyboard } from './bot.keyboards';
import { AudioMedia } from './media';

// Telegram не віддає ботам файли, більші за 20 МБ
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Спільна логіка розмови — для пересланих повідомлень і для підключеного чату (Telegram Business)
@Injectable()
export class ConversationService {
  private readonly timers = new Map<number, NodeJS.Timeout>();

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

  // draftWasSent: при пересиланні ми не бачимо, що він відправив, тож вважаємо, що нашу чернетку.
  // У підключеному чаті бачимо все самі — чернетку, яку він не відправив, просто відкидаємо.
  addHers(chatId: number, text: string, draftWasSent: boolean) {
    const session = this.sessions.get(chatId);
    if (session.draft && draftWasSent) {
      this.sessions.addLine(chatId, { from: 'me', text: session.draft });
    }
    session.draft = undefined;
    this.sessions.addLine(chatId, { from: 'her', text });
    this.scheduleReply(chatId);
  }

  // Кілька повідомлень підряд приходять окремо — чекаємо, поки пачка закінчиться
  private scheduleReply(chatId: number) {
    clearTimeout(this.timers.get(chatId));
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        void this.generate(chatId);
      }, BATCH_DELAY_MS),
    );
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

    await this.bot.telegram.sendChatAction(chatId, 'typing');
    try {
      const reply = await this.ai.generateReply(session, hint);
      session.draft = reply;
      await this.bot.telegram.sendMessage(
        chatId,
        reply,
        replyKeyboard(this.canSend(session)),
      );
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
    this.sessions.addLine(chatId, { from: 'me', text });
  }
}
