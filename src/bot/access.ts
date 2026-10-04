import type { Context, MiddlewareFn } from 'telegraf';

// Хто може користуватись ботом — Telegram ID через кому в ALLOWED_USER_IDS.
// Порожній список = бот закритий для всіх (і підказує, який у тебе ID)
const allowed = new Set(
  (process.env.ALLOWED_USER_IDS ?? '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number),
);

export function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && allowed.has(userId);
}

export const accessMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  // Бізнес-оновлення перевіряє BusinessHandler: там автор повідомлення — вона, а не власник
  if (Object.keys(ctx.update).some((key) => key.startsWith('business_'))) {
    return next();
  }
  if (isAllowed(ctx.from?.id)) return next();

  console.warn(
    `Доступ заборонено: ${ctx.from?.id} (@${ctx.from?.username ?? '—'})`,
  );
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('Це приватний бот');
  } else if (ctx.chat?.type === 'private') {
    await ctx.reply(
      allowed.size
        ? '🔒 Це приватний бот.'
        : `🔒 Бот поки закритий для всіх. Твій Telegram ID: ${ctx.from?.id}\n\nДодай у .env рядок ALLOWED_USER_IDS=${ctx.from?.id} і перезапусти бота.`,
    );
  }
};
