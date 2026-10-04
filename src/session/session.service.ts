import { Injectable } from '@nestjs/common';
import { DEFAULT_TONE } from '../tones/tones';
import { ChatLine, Session, StyleEdit } from './session.types';

const MAX_HISTORY = 30;
const MAX_STYLE_EDITS = 10;

// Зберігається в пам'яті — після перезапуску бота все скидається
@Injectable()
export class SessionService {
  private readonly sessions = new Map<number, Session>();

  get(chatId: number): Session {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = {
        toneKey: DEFAULT_TONE.key,
        emoji: false,
        history: [],
        styleEdits: [],
      };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  addLine(chatId: number, line: ChatLine) {
    const session = this.get(chatId);
    session.history.push(line);
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

  resetHistory(chatId: number) {
    const session = this.get(chatId);
    session.history = [];
    session.draft = undefined;
  }
}
