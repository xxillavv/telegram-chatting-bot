export type Speaker = 'her' | 'me';

export interface ChatLine {
  from: Speaker;
  text: string;
  // Коли написано (мс) — модель має розуміти паузи і час доби
  at?: number;
  // На яке повідомлення це відповідь (свайп «Відповісти» в Telegram)
  replyTo?: string;
  // id повідомлення в її чаті — щоб підхопити редагування і видалення
  messageId?: number;
}

// Те, що відомо про повідомлення крім тексту
export type LineMeta = Pick<ChatLine, 'at' | 'replyTo' | 'messageId'>;

// Його правка нашої відповіді — з них модель вчиться його стилю
export interface StyleEdit {
  before: string;
  after: string;
}

export interface SideStats {
  messages: number;
  words: number;
  questions: number;
}

// Лічильники за всю переписку — історія для LLM обрізається, а статистика ні
export interface ConversationStats {
  me: SideStats;
  her: SideStats;
}

export interface Session {
  toneKey: string;
  // Власний опис тону — якщо заданий, має пріоритет над пресетом
  customTone?: string;
  // Контекст: хто вона, як познайомились, що відомо
  about?: string;
  // Чи можна вставляти емодзі у відповіді
  emoji: boolean;
  history: ChatLine[];
  stats: ConversationStats;
  // Останній згенерований варіант, ще не підтверджений
  draft?: string;
  // Повідомлення бота з цією чернеткою — щоб позначити його застарілим
  draftMessageId?: number;
  awaiting?: 'tone' | 'about' | 'aboutMe' | 'edit' | 'link';
  // Текст відповіді, яку він зараз править
  editTarget?: string;
  // Останні запропоновані питання — щоб обрати одне кнопкою
  questions?: string[];
  // Підключення через Telegram Business — бот бачить її чат і може відповідати від його імені
  business?: {
    connectionId: string;
    ownerId: number;
    canReply: boolean;
    enabled: boolean;
  };
  // Відправляти відповіді самому, якщо він не зупинив таймер
  autoSend?: boolean;
  // Чат з нею, за яким стежимо
  linked?: { chatId: number; name: string };
  // Бізнес-чати, з яких приходили повідомлення: id → ім'я
  seenChats: Record<number, string>;
  // Юзернейми тих самих чатів (без @, малими літерами) → id
  seenUsernames?: Record<string, number>;
  // Юзернейм, який він вказав, а вона ще не писала — підключимо з першим повідомленням
  pendingLink?: string;
  // Не скидається разом з історією — стиль один на весь чат
  styleEdits: StyleEdit[];
  // Довга пам'ять: факти про неї, які LLM сама витягує з переписки
  facts?: string[];
  // Що він сам розповів про себе — модель не вигадує те, чого тут нема
  aboutMe?: string;
  // Факти про нього з його реплік; не скидаються з історією — він той самий
  myFacts?: string[];
  // Скільки повідомлень додалось після останнього оновлення фактів
  factsPending?: number;
}
