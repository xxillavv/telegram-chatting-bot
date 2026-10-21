import { ChatLine } from '../session/session.types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Час рахуємо за його годинником, а не за сервером
const TIME_ZONE = process.env.BOT_TIMEZONE || 'Europe/Kyiv';

const whenFormat = new Intl.DateTimeFormat('uk-UA', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('uk-UA', {
  timeZone: TIME_ZONE,
  dateStyle: 'short',
});

export function formatWhen(at: number): string {
  return whenFormat.format(at);
}

export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatGap(ms: number): string {
  if (ms >= DAY) {
    const days = Math.round(ms / DAY);
    return `${days} ${plural(days, 'день', 'дні', 'днів')}`;
  }
  if (ms >= HOUR) {
    const hours = Math.round(ms / HOUR);
    return `${hours} ${plural(hours, 'годину', 'години', 'годин')}`;
  }
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `${minutes} ${plural(minutes, 'хвилину', 'хвилини', 'хвилин')}`;
}

// Позначка часу перед рядком — лише на початку і після помітної паузи чи зміни дня, щоб не засмічувати промпт
export function timeMarker(
  line: ChatLine,
  prev: ChatLine | undefined,
): string | undefined {
  if (!line.at) return undefined;
  if (!prev?.at) return `[${formatWhen(line.at)}]`;
  const gap = line.at - prev.at;
  const newDay = dayFormat.format(line.at) !== dayFormat.format(prev.at);
  if (gap < HOUR && !newDay) return undefined;
  return `[через ${formatGap(gap)}, ${formatWhen(line.at)}]`;
}

// Що зараз і скільки минуло від останнього повідомлення
export function nowContext(history: ChatLine[], now = Date.now()): string {
  const parts = [`Зараз: ${formatWhen(now)}.`];
  const last = history.at(-1);
  if (last?.at && now - last.at >= HOUR) {
    const who = last.from === 'her' ? 'її' : 'моє';
    parts.push(
      `Останнє повідомлення (${who}) було ${formatGap(now - last.at)} тому.`,
    );
  }
  return parts.join(' ');
}
