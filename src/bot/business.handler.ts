import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Markup, Telegraf } from 'telegraf';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import {
  BusinessConnection,
  BusinessMessage,
  canReply,
} from './business.types';
import { ConversationService } from './conversation.service';
import { describeNonText, extractAudio } from './media';

type BusinessUpdate = {
  business_connection?: BusinessConnection;
  business_message?: BusinessMessage;
};

// Telegram Business: власник підключає бота в налаштуваннях Telegram,
// і бот отримує повідомлення з вибраних чатів та може відповідати від його імені
@Injectable()
export class BusinessHandler implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly sessions: SessionService,
    private readonly conversation: ConversationService,
  ) {}

  onModuleInit() {
    this.bot.use(async (ctx, next) => {
      const update = ctx.update as BusinessUpdate;
      try {
        if (update.business_connection) {
          await this.onConnection(update.business_connection);
        } else if (update.business_message) {
          await this.onMessage(update.business_message);
        } else {
          return next();
        }
      } catch (error) {
        console.error(error);
      }
    });
  }

  private applyConnection(connection: BusinessConnection): Session {
    const session = this.sessions.get(connection.user_chat_id);
    session.business = {
      connectionId: connection.id,
      ownerId: connection.user.id,
      canReply: canReply(connection),
      enabled: connection.is_enabled,
    };
    return session;
  }

  private async onConnection(connection: BusinessConnection) {
    const session = this.applyConnection(connection);
    const owner = connection.user_chat_id;

    if (!connection.is_enabled) {
      session.linked = undefined;
      await this.bot.telegram.sendMessage(
        owner,
        '🔌 Бота відключено від Telegram для бізнесу. Повідомлення знову можна пересилати вручну.',
      );
      return;
    }

    await this.bot.telegram.sendMessage(
      owner,
      session.business!.canReply
        ? '✅ Бот підключений до Telegram для бізнесу. Коли вона напише в одному з вибраних чатів, я запропоную його підключити.'
        : '⚠️ Бот підключений, але без дозволу відповідати. Увімкни «Відповідати на повідомлення» в налаштуваннях чат-бота, інакше кнопки «Відправити» не буде.',
    );
  }

  // Після перезапуску сесії порожні — дізнаємось власника підключення через API
  private async resolveSession(connectionId: string): Promise<Session> {
    const known = this.sessions.findByConnection(connectionId);
    if (known) return known;
    const connection = (await this.bot.telegram.callApi(
      'getBusinessConnection' as never,
      { business_connection_id: connectionId } as never,
    )) as BusinessConnection;
    return this.applyConnection(connection);
  }

  private async onMessage(message: BusinessMessage) {
    // Наше ж повідомлення, відправлене кнопкою «Відправити», — вже в історії
    if (message.sender_business_bot) return;

    const session = await this.resolveSession(message.business_connection_id);
    const owner = session.business!.ownerId;
    const chat = message.chat as {
      id: number;
      first_name?: string;
      username?: string;
    };
    const name = chat.first_name ?? chat.username ?? 'Співрозмовник';

    if (session.linked?.chatId !== chat.id) {
      await this.offerLink(owner, session, chat.id, name);
      return;
    }

    const fromOwner = message.from?.id === session.business!.ownerId;
    const text = await this.extractText(owner, message);
    if (!text) return;

    if (fromOwner) {
      // Він написав їй сам з телефона — це теж його стиль
      this.conversation.addMine(owner, text);
      return;
    }

    // Сповіщення прийде одне на всю пачку, коли вона допише
    this.conversation.addHers(owner, text, true);
  }

  private async extractText(
    owner: number,
    message: BusinessMessage,
  ): Promise<string | undefined> {
    if ('text' in message) return message.text;
    const caption = 'caption' in message ? message.caption : undefined;

    const audio = extractAudio(message);
    if (audio) {
      try {
        return await this.conversation.transcribe(audio);
      } catch (error) {
        console.error(error);
        await this.bot.telegram.sendMessage(
          owner,
          'Не вдалося розпізнати голосове з чату 🙏',
        );
        return undefined;
      }
    }

    const kind = describeNonText(message);
    if (kind) return caption ? `${kind} ${caption}` : kind;
    return caption;
  }

  // Новий чат з'явився — пропонуємо підключити, але лише раз і лише коли ще нічого не підключено
  private async offerLink(
    owner: number,
    session: Session,
    chatId: number,
    name: string,
  ) {
    const isNew = !(chatId in session.seenChats);
    session.seenChats[chatId] = name;
    if (!isNew || session.linked) return;

    await this.bot.telegram.sendMessage(
      owner,
      `📩 Нове повідомлення від ${name}. Стежити за цим чатом?`,
      Markup.inlineKeyboard([
        Markup.button.callback(`🔗 Підключити ${name}`, `link:${chatId}`),
      ]),
    );
  }
}
