export type Speaker = 'her' | 'me';

export interface ChatLine {
  from: Speaker;
  text: string;
}

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
  awaiting?: 'tone' | 'about' | 'edit';
  // Текст відповіді, яку він зараз править
  editTarget?: string;
  // Останні запропоновані питання — щоб обрати одне кнопкою
  questions?: string[];
  // Не скидається разом з історією — стиль один на весь чат
  styleEdits: StyleEdit[];
}
