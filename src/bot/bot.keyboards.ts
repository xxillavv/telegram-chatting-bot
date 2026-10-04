import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { Session } from '../session/session.types';
import { TONES } from '../tones/tones';
import { MENU } from './bot.constants';

type InlineKeyboard = Markup.Markup<InlineKeyboardMarkup>;

export const mainMenu: Markup.Markup<ReplyKeyboardMarkup> = Markup.keyboard([
  [MENU.tone, MENU.about],
  [MENU.settings, MENU.reset],
  [MENU.emoji, MENU.help],
])
  .resize()
  .persistent();

export const replyKeyboard: InlineKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('✏️ Підправити', 'edit_reply')],
  [
    Markup.button.callback('🔄 Інший варіант', 'regen'),
    Markup.button.callback('✂️ Коротше', 'shorter'),
  ],
]);

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
