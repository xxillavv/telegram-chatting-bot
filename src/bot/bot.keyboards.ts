import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { Session } from '../session/session.types';
import { TONES } from '../tones/tones';
import { MENU } from './bot.constants';
import { canSendTo } from './business.types';

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

// Варіант, який піде сам, якщо не зупинити
export function autoSendKeyboard(seconds: number): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `⏸ Стоп (піде сам через ${seconds} с)`,
        'auto_stop',
      ),
    ],
    [
      Markup.button.callback('🚀 Зараз', 'send_reply'),
      Markup.button.callback('✏️ Підправити', 'edit_reply'),
    ],
  ]);
}

function autoSendButton(session: Session) {
  return Markup.button.callback(
    session.autoSend ? '🤖 Автовідправка: увімк' : '✋ Автовідправка: вимк',
    'toggle_auto',
  );
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
  return Markup.inlineKeyboard([
    ...(canSendTo(session) ? [[autoSendButton(session)]] : []),
    [Markup.button.callback('🔁 Інший чат', 'change_chat')],
    ...(session.linked || session.pendingLink
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
    ...(canSendTo(session) ? [[autoSendButton(session)]] : []),
    ...(session.facts?.length
      ? [[Markup.button.callback('🧠 Що я про неї знаю', 'show_facts')]]
      : []),
    ...(session.styleEdits.length
      ? [[Markup.button.callback('🧽 Скинути мій стиль', 'clear_style')]]
      : []),
  ]);
}

export const factsKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('🗑 Забути все', 'clear_facts'),
]);

export const cancelKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('❌ Скасувати', 'cancel_input'),
]);

export const resetConfirmKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('🧹 Так, очистити', 'reset_confirm'),
  Markup.button.callback('Скасувати', 'reset_cancel'),
]);
