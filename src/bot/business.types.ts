import type { Message, User } from 'telegraf/types';

// Telegraf 4.16 ще не знає про Telegram Business (Bot API 7.2+) — описуємо потрібне самі

export interface BusinessConnection {
  id: string;
  user: User;
  user_chat_id: number;
  is_enabled: boolean;
  // Bot API 7.2–8.x
  can_reply?: boolean;
  // Bot API 9.0+
  rights?: { can_reply?: boolean };
}

export type BusinessMessage = Message & {
  business_connection_id: string;
  // Заповнене, якщо повідомлення відправив бот від імені власника
  sender_business_bot?: User;
};

export const BUSINESS_UPDATES = [
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
] as const;

export function canReply(connection: BusinessConnection): boolean {
  return Boolean(connection.rights?.can_reply ?? connection.can_reply);
}
