// Скільки чекати на продовження, поки вона дописує кілька коротких повідомлень підряд.
// Бот не бачить статусу «друкує…», тож орієнтуємось на те, як закінчується останнє повідомлення.

// Пересилання приходить пачкою майже одночасно — довго чекати не треба
export const FORWARD_DELAY_MS = 1500;

const FINISHED_DELAY_MS = 3000;
const NEUTRAL_DELAY_MS = 5000;
const UNFINISHED_DELAY_MS = 9000;
// Навіть якщо вона пише без кінця, не мовчимо довше за це від першого повідомлення
export const MAX_BATCH_WAIT_MS = 25000;

// Слова, після яких зазвичай буде продовження
const CONTINUATION =
  /(^|\s)(і|й|та|а|але|що|бо|ну|слухай|короче|коротше|типу|ще|і ще|а ще|і от|от|потім|просто|кароч|в общем|и|но|что|потому)$/i;
const FINISHED = /[?!.…)]$|\p{Extended_Pictographic}$/u;

export function liveDelay(text: string): number {
  const trimmed = text.trim().toLowerCase();
  if (
    trimmed.endsWith(',') ||
    trimmed.endsWith(':') ||
    CONTINUATION.test(trimmed)
  ) {
    return UNFINISHED_DELAY_MS;
  }
  if (FINISHED.test(trimmed)) return FINISHED_DELAY_MS;
  // Одне-два слова без розділового знака — схоже на початок думки
  if (trimmed.split(/\s+/).length <= 2) return UNFINISHED_DELAY_MS;
  return NEUTRAL_DELAY_MS;
}
