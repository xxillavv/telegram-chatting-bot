import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { localHour } from '../ai/time';
import { SessionService } from '../session/session.service';
import { Session } from '../session/session.types';
import { canSendTo } from './business.types';
import { ConversationService } from './conversation.service';

const HOUR = 60 * 60 * 1000;
// Скільки годин тиші в чаті, перш ніж запропонувати написати першим
const NUDGE_AFTER_MS = (Number(process.env.NUDGE_AFTER_HOURS) || 24) * HOUR;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
// Пропонуємо лише вдень за його годинником — щоб не будити ні його, ні її
const DAY_START_HOUR = 10;
const DAY_END_HOUR = 22;

// Слідкує за підключеними чатами і, коли розмова надовго затихла, пропонує повідомлення,
// щоб її відновити
@Injectable()
export class NudgeService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(NudgeService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly conversation: ConversationService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  beforeApplicationShutdown() {
    clearInterval(this.timer);
  }

  private isDue(session: Session, now: number): boolean {
    const last = session.history.at(-1);
    return Boolean(
      session.nudge !== false &&
      canSendTo(session) &&
      last?.at &&
      now - last.at >= NUDGE_AFTER_MS &&
      session.nudgedFor !== last.at &&
      session.history.some((line) => line.from === 'her'),
    );
  }

  private async check() {
    const hour = localHour();
    if (this.running || hour < DAY_START_HOUR || hour >= DAY_END_HOUR) return;
    this.running = true;
    try {
      const now = Date.now();
      // По одному, щоб не впертись у ліміти LLM
      for (const [chatId, session] of this.sessions.entries()) {
        if (!this.isDue(session, now)) continue;
        // Позначаємо заздалегідь: якщо генерація впала, не повторюємо її кожні 10 хвилин
        session.nudgedFor = session.history.at(-1)!.at;
        try {
          await this.conversation.nudge(chatId);
        } catch (error) {
          this.logger.error(`Не вдалося запропонувати повідомлення`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
