import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { Session } from '../session/session.types';
import { TONES } from '../tones/tones';
import { MENU } from './bot.constants';

type InlineKeyboard = Markup.Markup<InlineKeyboardMarkup>;

export const mainMenu: Markup.Markup<ReplyKeyboardMarkup> = Markup.keyboard([
  [MENU.questions, MENU.stats],
  [MENU.tone, MENU.about],
  [MENU.chat, MENU.settings],
  [MENU.emoji, MENU.reset],
  [MENU.help],
])
  .resize()
  .persistent();

const sendButton = Markup.button.callback('✅ Відправити', 'send_reply');

// Кнопка «Відправити» — лише коли її чат підключено через Telegram Business
export function replyKeyboard(canSend: boolean): InlineKeyboard {
  return Markup.inlineKeyboard([
    ...(canSend ? [[sendButton]] : []),
    [Markup.button.callback('✏️ Підправити', 'edit_reply')],
    [
      Markup.button.callback('🔄 Інший варіант', 'regen'),
      Markup.button.callback('✂️ Коротше', 'shorter'),
    ],
  ]);
}

export function questionsKeyboard(count: number): InlineKeyboard {
  return Markup.inlineKeyboard([
    Array.from({ length: count }, (_, i) =>
      Markup.button.callback(`${i + 1}`, `question:${i}`),
    ),
    [Markup.button.callback('🔄 Інші питання', 'more_questions')],
  ]);
}

export function questionKeyboard(canSend: boolean): InlineKeyboard {
  return Markup.inlineKeyboard([
    ...(canSend ? [[sendButton]] : []),
    [
      Markup.button.callback('✏️ Підправити', 'edit_reply'),
      Markup.button.callback('🔄 Інші питання', 'more_questions'),
    ],
  ]);
}

export function chatKeyboard(session: Session): InlineKeyboard {
  const others = Object.entries(session.seenChats).filter(
    ([id]) => Number(id) !== session.linked?.chatId,
  );
  return Markup.inlineKeyboard([
    ...others.map(([id, name]) => [
      Markup.button.callback(`🔗 ${name}`, `link:${id}`),
    ]),
    ...(session.linked
      ? [[Markup.button.callback('🔌 Відключити', 'unlink')]]
      : []),
  ]);
}

export function toneKeyboard(session: Session): InlineKeyboard {
  const current = session.customTone ? null : session.toneKey;
  return Markup.inlineKeyboard([
    ...TONES.map((t) => [
      Markup.button.callback(
        t.key === current ? `✓ ${t.label}` : t.label,
        `tone:${t.key}`,
      ),
    ]),
    [
      Markup.button.callback(
        session.customTone ? '✓ ✍️ Свій варіант' : '✍️ Свій варіант',
        'custom_tone',
      ),
    ],
  ]);
}

export function settingsKeyboard(session: Session): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎭 Змінити тон', 'open_tone'),
      Markup.button.callback('👩 Змінити контекст', 'open_about'),
    ],
    [
      Markup.button.callback(
        session.emoji ? '😀 Емодзі: увімк' : '🚫 Емодзі: вимк',
        'toggle_emoji',
      ),
      Markup.button.callback('🗑 Видалити контекст', 'clear_about'),
    ],
    ...(session.styleEdits.length
      ? [[Markup.button.callback('🧽 Скинути мій стиль', 'clear_style')]]
      : []),
  ]);
}

export const cancelKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('❌ Скасувати', 'cancel_input'),
]);

export const resetConfirmKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('🧹 Так, очистити', 'reset_confirm'),
  Markup.button.callback('Скасувати', 'reset_cancel'),
]);
