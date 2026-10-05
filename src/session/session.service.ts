import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../database/database.module';
import { DEFAULT_TONE } from '../tones/tones';
import {
  ChatLine,
  ConversationStats,
  Session,
  StyleEdit,
} from './session.types';

const MAX_HISTORY = 30;
const MAX_STYLE_EDITS = 10;
// Як часто зміни сесій скидаються в базу
const FLUSH_INTERVAL_MS = 2000;

type SessionDoc = Session & { _id: number };

function emptyStats(): ConversationStats {
  return {
    me: { messages: 0, words: 0, questions: 0 },
    her: { messages: 0, words: 0, questions: 0 },
  };
}

// Сесії живуть у пам'яті (код змінює їх напряму), а в MongoDB
// періодично записуються ті, що змінились, — щоб пережити перезапуск
@Injectable()
export class SessionService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessions = new Map<number, Session>();
  // Останній записаний у базу стан кожної сесії
  private readonly saved = new Map<number, string>();
  private readonly collection: Collection<SessionDoc>;
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.collection = db.collection<SessionDoc>('sessions');
  }

  async onModuleInit() {
    const docs = await this.collection.find().toArray();
    for (const { _id, ...session } of docs) {
      this.sessions.set(_id, session);
      this.saved.set(_id, JSON.stringify(session));
    }
    this.logger.log(`Завантажено сесій з бази: ${docs.length}`);
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  async beforeApplicationShutdown() {
    clearInterval(this.timer);
    await this.flush();
  }

  private flush(): Promise<void> {
    // Не запускаємо другий запис, поки йде попередній
    this.flushing ??= this.writeChanged().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async writeChanged() {
    const changed: [number, string, Session][] = [];
    for (const [chatId, session] of this.sessions) {
      const json = JSON.stringify(session);
      if (this.saved.get(chatId) !== json)
        changed.push([chatId, json, session]);
    }
    if (!changed.length) return;

    try {
      await this.collection.bulkWrite(
        changed.map(([chatId, json]) => ({
          replaceOne: {
            filter: { _id: chatId },
            // Копія через JSON — щоб не записати undefined-поля і стан, змінений під час запису
            replacement: { _id: chatId, ...(JSON.parse(json) as Session) },
            upsert: true,
          },
        })),
      );
      for (const [chatId, json] of changed) this.saved.set(chatId, json);
    } catch (err) {
      this.logger.error('Не вдалося зберегти сесії в базу', err);
    }
  }

  get(chatId: number): Session {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = {
        toneKey: DEFAULT_TONE.key,
        emoji: false,
        history: [],
        stats: emptyStats(),
        styleEdits: [],
        seenChats: {},
      };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  findByConnection(connectionId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.business?.connectionId === connectionId) return session;
    }
    return undefined;
  }

  addLine(chatId: number, line: ChatLine) {
    const session = this.get(chatId);
    session.history.push(line);
    session.factsPending = this.factsPending(session) + 1;

    const side = session.stats[line.from];
    side.messages++;
    side.words += line.text.split(/\s+/).filter(Boolean).length;
    if (line.text.includes('?')) side.questions++;

    if (session.history.length > MAX_HISTORY) {
      session.history.splice(0, session.history.length - MAX_HISTORY);
    }
  }

  addStyleEdit(chatId: number, edit: StyleEdit) {
    if (edit.before.trim() === edit.after.trim()) return;
    const { styleEdits } = this.get(chatId);
    styleEdits.push(edit);
    if (styleEdits.length > MAX_STYLE_EDITS) {
      styleEdits.splice(0, styleEdits.length - MAX_STYLE_EDITS);
    }
  }

  // Для сесій, створених до появи пам'яті, — вся наявна історія ще не розібрана
  factsPending(session: Session): number {
    return session.factsPending ?? session.history.length;
  }

  resetHistory(chatId: number) {
    const session = this.get(chatId);
    session.history = [];
    session.stats = emptyStats();
    session.draft = undefined;
    // Факти взяті з цієї переписки — нова переписка, найчастіше, з іншою дівчиною
    session.facts = [];
    session.factsPending = 0;
  }
}
