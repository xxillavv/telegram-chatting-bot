// Збирає з експорту переписки Telegram (result.json) пари «вона написала → я відповів»
// і записує їх у private/style.json як приклади стилю. Решту полів файлу не чіпає.
//
//   node scripts/build-style.mjs private/chat/result.json
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Пауза, після якої наступне повідомлення вже не продовжує попереднє
const BURST_GAP_MS = 3 * 60 * 1000;
// Відповідь пізніше — це вже не відповідь, а нова розмова
const MAX_REPLY_DELAY_MS = 10 * 60 * 1000;
const MAX_HER_LINES = 3;
const MAX_MY_LINES = 5;
const MAX_HER_WORDS_PER_LINE = 25;
const MAX_MY_WORDS_PER_LINE = 12;
const MAX_MY_WORDS = 30;

const file = process.argv[2];
if (!file) {
  console.error('Вкажи шлях до result.json з експорту Telegram');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
// В експорті особистого чату id — це співрозмовниця, решта повідомлень мої
const her = `user${data.id}`;
const flat = (text) =>
  typeof text === 'string'
    ? text
    : text
        .map((part) => (typeof part === 'string' ? part : part.text))
        .join('');
const words = (text) => text.split(/\s+/).filter(Boolean).length;

const messages = data.messages
  .filter((m) => m.type === 'message')
  .map((m) => ({
    mine: m.from_id !== her,
    at: Number(m.date_unixtime) * 1000,
    text: flat(m.text ?? '').trim(),
    media: Boolean(m.media_type || m.photo || m.location_information),
  }));

const bursts = [];
for (const message of messages) {
  const last = bursts.at(-1);
  if (
    last &&
    last.mine === message.mine &&
    message.at - last.end < BURST_GAP_MS
  ) {
    last.items.push(message);
    last.end = message.at;
  } else {
    bursts.push({
      mine: message.mine,
      items: [message],
      start: message.at,
      end: message.at,
    });
  }
}

// Лише текст, без посилань і довгих чисел (телефони, картки)
const clean = (m) =>
  !m.media &&
  m.text &&
  !/https?:\/\/|@\w|\d{5,}/.test(m.text) &&
  /\p{L}/u.test(m.text);

const examples = [];
const seen = new Set();
for (let i = 1; i < bursts.length; i++) {
  const [prev, next] = [bursts[i - 1], bursts[i]];
  if (prev.mine || !next.mine || next.start - prev.end > MAX_REPLY_DELAY_MS)
    continue;

  const herLines = prev.items.slice(-MAX_HER_LINES);
  const myLines = next.items.slice(0, MAX_MY_LINES);
  if (!herLines.every(clean) || !myLines.every(clean)) continue;
  if (herLines.some((m) => words(m.text) > MAX_HER_WORDS_PER_LINE)) continue;
  if (myLines.some((m) => words(m.text) > MAX_MY_WORDS_PER_LINE)) continue;
  const total = myLines.reduce((sum, m) => sum + words(m.text), 0);
  if (total < 2 || total > MAX_MY_WORDS) continue;

  const example = {
    her: herLines.map((m) => m.text),
    me: myLines.map((m) => m.text),
  };
  const key = JSON.stringify(example).toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  examples.push(example);
}

const target = join(process.cwd(), 'private', 'style.json');
const style = existsSync(target)
  ? JSON.parse(readFileSync(target, 'utf8'))
  : {};
style.examples = examples;
writeFileSync(target, `${JSON.stringify(style, null, 2)}\n`);
console.log(
  `Пар «вона → я»: ${examples.length} з ${bursts.length} пачок повідомлень. Записано в ${target}`,
);
