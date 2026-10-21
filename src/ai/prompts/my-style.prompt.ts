import { readFileSync } from 'fs';
import { join } from 'path';

type DialogExample = { her: string[]; me: string[] };

// Особисте (опис себе, справжні повідомлення, приклади з переписки) лежить у private/style.json —
// цю папку git ігнорує, бо репозиторій публічний. Нема файлу — працюємо зі стандартним стилем
type PrivateStyle = {
  aboutMe?: string;
  myMessages?: string[];
  style?: string;
  examples?: DialogExample[];
};

function loadPrivateStyle(): PrivateStyle {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'private', 'style.json'),
      'utf8',
    );
    return JSON.parse(raw) as PrivateStyle;
  } catch {
    return {};
  }
}

const PRIVATE = loadPrivateStyle();

// Як він сам пише дівчатам — з його відповідей на питання і справжніх повідомлень.
// Тон задає настрій, а цей профіль — форму, тому він діє завжди
const DEFAULT_STYLE = `МІЙ СТИЛЬ ПИСЬМА (завжди пиши саме так, хоч який тон: тон задає настрій, а це форма):
- Пишу кількома короткими повідомленнями підряд. Розбивай відповідь на 1–4 коротких повідомлення, кожне з нового рядка, по 1–8 слів. Найчастіше 2–3 повідомлення, чотири лише коли вона написала розгорнуто.
- Все з маленької літери, без крапок у кінці. Коми рідко. Знак питання можна.
- Розмовна українська. Зрідка, не частіше ніж раз на кілька повідомлень, проскакує російське слово.
- Часто вживаю «там», «взагалі», «щось типу того», «так», «по життю».
- Сміюсь буквами: «ахах», «хахах». Дужок не ставлю.
- Звертаюсь на ім'я, іноді «зая» чи «сонце», зовсім рідко «малишка». Не в кожному повідомленні.
- Манера: спокійна, трохи лінива, з підколами й іронією. Без пафосу, без компліментів-штампів і довгих пояснень.`;

const MY_MESSAGES = PRIVATE.myMessages?.length
  ? `\n\nПриклади моїх справжніх повідомлень (кожен рядок — окреме повідомлення, лише для форми, а не для змісту):\n${PRIVATE.myMessages.join('\n')}`
  : '';

export const MY_STYLE = (PRIVATE.style || DEFAULT_STYLE) + MY_MESSAGES;

// Його постійний опис себе — йде у блок «факти про мене» разом із фактами з переписки
export const MY_ABOUT = PRIVATE.aboutMe?.trim() || undefined;

// Скільки окремих повідомлень максимум в одній відповіді
export const MAX_REPLY_MESSAGES = 4;

// Формат, який модель часто ігнорує, — доводимо самі
export const STYLE_FORMAT = {
  lowercase: true,
  noTrailingPeriod: true,
};

// Короткі живі обміни — йдуть у запит як попередні відповіді моделі:
// манеру з «власних» реплік модель переймає набагато сильніше, ніж з опису
const DEFAULT_EXAMPLES: DialogExample[] = [
  { her: ['ахах ну ти даєш'], me: ['а шо я', 'я взагалі святий'] },
  {
    her: ['я на роботі вже десяту годину', 'сил нуль'],
    me: ['жесть', 'тебе там хоч годують'],
  },
  {
    her: ['подивилась той фільм що ти радив', 'ну таке'],
    me: ['та ну', 'мені зайшов взагалі'],
  },
  { her: ['ок'], me: ['ок'] },
  { her: ['а ти часом не бот?'], me: ['ахах шо', 'з чого такі висновки'] },
  { her: ['мені сьогодні якось сумно'], me: ['шо сталось'] },
  { her: ['знаєш що', 'я склала іспит'], me: ['та ладно', 'красава'] },
  {
    her: ['в суботу вільна до речі'],
    me: ['го тоді кудись', 'на каву там чи погуляти'],
  },
];

// Скільки прикладів іде в один запит: ліміт Groq — 8000 токенів на хвилину разом із відповіддю
const EXAMPLES_PER_REQUEST = 8;
// Скільки з них — найближчих до її нових повідомлень; решта випадкові, щоб не зациклюватись на тих самих
const SIMILAR_EXAMPLES = 5;

// Слова, які є майже в кожному повідомленні й нічого не кажуть про тему
const STOP_WORDS = new Set(
  'але або так там тут шо що це мене тебе мені тобі вже ще ше теж типу тіпа просто дуже якщо коли тому того щоб для про від при без над під все всі вона він вони мій моя мої твій твоя бля блять яка який які чому чого хто ніби таке такий така було буде був була ось навіть можна треба нада знаю прям щось шось якось мабуть напевно його її них нас вас нам вам'.split(
    ' ',
  ),
);

// Грубий стемінг — обрізаємо закінчення, щоб «макет» і «макетом» збігались
function terms(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('uk')
      .replace(/[^\p{L}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

function wordCount(lines: string[]): number {
  return lines.join(' ').split(/\s+/).filter(Boolean).length;
}

// Та сама межа «коротко / середньо / розгорнуто», що й у бюджеті відповіді
function lengthBucket(words: number): number {
  if (words <= 3) return 0;
  return words <= 15 ? 1 : 2;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const term of a) if (b.has(term)) common++;
  return common / Math.sqrt(a.size * b.size);
}

const POOL = (
  PRIVATE.examples?.length ? PRIVATE.examples : DEFAULT_EXAMPLES
).map((example) => ({
  example,
  terms: terms(example.her.join(' ')),
  bucket: lengthBucket(wordCount(example.her)),
}));

// Приклади під її нові повідомлення: найсхожіші ситуації з його справжньої переписки
// (за словами, а без спільних слів — хоча б за довжиною) плюс кілька випадкових
export function pickExamples(herLines: string[]): DialogExample[] {
  if (POOL.length <= EXAMPLES_PER_REQUEST) return POOL.map((p) => p.example);

  const query = terms(herLines.join(' '));
  const bucket = lengthBucket(wordCount(herLines));
  const similar = POOL.map((entry) => ({
    entry,
    // Трохи випадковості, щоб серед рівних не брати щоразу ті самі
    score:
      overlap(query, entry.terms) +
      (entry.bucket === bucket ? 0.1 : 0) +
      Math.random() * 0.05,
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SIMILAR_EXAMPLES)
    .map((s) => s.entry);

  const rest = POOL.filter((entry) => !similar.includes(entry));
  const random: typeof POOL = [];
  while (random.length < EXAMPLES_PER_REQUEST - similar.length) {
    random.push(...rest.splice(Math.floor(Math.random() * rest.length), 1));
  }
  // Найсхожіші — останніми, ближче до її справжнього повідомлення
  return [...random, ...similar.reverse()].map((entry) => entry.example);
}
