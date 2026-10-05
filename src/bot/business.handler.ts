import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { SessionService } from '../session/session.service';
import { LineMeta, Session } from '../session/session.types';
import {
  BusinessConnection,
  BusinessMessage,
  BusinessMessagesDeleted,
  canReply,
} from './business.types';
import { isAllowed } from './access';
import { ConversationService } from './conversation.service';
import { describeNonText, extractAudio } from './media';
import type { Message } from 'telegraf/types';

type BusinessUpdate = {
  business_connection?: BusinessConnection;
  business_message?: BusinessMessage;
  edited_business_message?: BusinessMessage;
  deleted_business_messages?: BusinessMessagesDeleted;
};

// Telegraf 4.16 не знає про цитату частини повідомлення (Bot API 7.0)
type ReplyInfo = {
  reply_to_message?: Message;
  quote?: { text: string };
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
        } else if (update.edited_business_message) {
          await this.onEdited(update.edited_business_message);
        } else if (update.deleted_business_messages) {
          await this.onDeleted(update.deleted_business_messages);
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
    // Чужий акаунт підключив нашого бота — ігноруємо
    if (!isAllowed(connection.user.id)) {
      console.warn(
        `Business-підключення від чужого акаунта: ${connection.user.id}`,
      );
      return;
    }
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
        ? '✅ Бот підключений до Telegram для бізнесу. Тепер напиши /chat і вкажи її @username, щоб я стежив за її чатом.'
        : '⚠️ Бот підключений, але без дозволу відповідати. Увімкни «Відповідати на повідомлення» в налаштуваннях чат-бота, інакше кнопки «Відправити» не буде.',
    );
  }

  // Після перезапуску сесії порожні — дізнаємось власника підключення через API
  private async resolveSession(
    connectionId: string,
  ): Promise<Session | undefined> {
    const known = this.sessions.findByConnection(connectionId);
    if (known) return known;
    const connection = (await this.bot.telegram.callApi(
      'getBusinessConnection' as never,
      { business_connection_id: connectionId } as never,
    )) as BusinessConnection;
    if (!isAllowed(connection.user.id)) return undefined;
    return this.applyConnection(connection);
  }

  private async onMessage(message: BusinessMessage) {
    // Наше ж повідомлення, відправлене кнопкою «Відправити», — вже в історії
    if (message.sender_business_bot) return;

    const session = await this.resolveSession(message.business_connection_id);
    if (!session) return;
    const owner = session.business!.ownerId;
    const chat = message.chat as {
      id: number;
      first_name?: string;
      username?: string;
    };
    const name = chat.first_name ?? chat.username ?? 'Співрозмовник';

    this.remember(session, chat.id, name, chat.username);
    if (
      session.pendingLink &&
      session.pendingLink === chat.username?.toLowerCase()
    ) {
      this.sessions.link(owner, { chatId: chat.id, name });
      await this.bot.telegram.sendMessage(
        owner,
        `🔗 Підключено чат з ${name}. Її нові повідомлення прийдуть сюди разом з варіантом відповіді.`,
      );
    }
    // Чужі чати лише запам'ятовуємо мовчки — підключає він сам через /chat
    if (session.linked?.chatId !== chat.id) return;

    const fromOwner = message.from?.id === session.business!.ownerId;
    const text = await this.extractText(owner, message);
    if (!text) return;
    const meta = this.lineMeta(message);

    if (fromOwner) {
      // Він написав їй сам з телефона — це теж його стиль
      this.conversation.addMine(owner, text, meta);
      return;
    }

    // Сповіщення прийде одне на всю пачку, коли вона допише
    this.conversation.addHers(owner, text, true, meta);
  }

  private lineMeta(message: BusinessMessage): LineMeta {
    const { reply_to_message: replied, quote } = message as ReplyInfo;
    let replyTo: string | undefined = quote?.text;
    if (!replyTo && replied) {
      replyTo =
        ('text' in replied && replied.text) ||
        ('caption' in replied && replied.caption) ||
        describeNonText(replied) ||
        undefined;
    }
    return {
      at: message.date * 1000,
      messageId: message.message_id,
      replyTo,
    };
  }

  private async onEdited(message: BusinessMessage) {
    const session = await this.resolveSession(message.business_connection_id);
    if (!session || session.linked?.chatId !== message.chat.id) return;
    const text =
      ('text' in message && message.text) ||
      ('caption' in message && message.caption);
    if (!text) return;
    this.conversation.editLine(
      session.business!.ownerId,
      message.message_id,
      text,
    );
  }

  private async onDeleted(update: BusinessMessagesDeleted) {
    const session = await this.resolveSession(update.business_connection_id);
    if (!session || session.linked?.chatId !== update.chat.id) return;
    this.conversation.removeLines(
      session.business!.ownerId,
      update.message_ids,
    );
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

  // Щоб підключити чат за юзернеймом одразу, якщо вона вже писала
  private remember(
    session: Session,
    chatId: number,
    name: string,
    username?: string,
  ) {
    session.seenChats[chatId] = name;
    if (username) {
      session.seenUsernames ??= {};
      session.seenUsernames[username.toLowerCase()] = chatId;
    }
    // Поки вона не писала, замість імені стояв юзернейм
    if (session.linked?.chatId === chatId) session.linked.name = name;
  }
}
