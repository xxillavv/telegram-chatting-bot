import { InterestAnalysis } from '../ai/interest.types';
import { ConversationStats, SideStats } from '../session/session.types';

function percent(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : '0%';
}

function average(side: SideStats): string {
  return side.messages ? (side.words / side.messages).toFixed(1) : '0';
}

// Проста оцінка балансу без LLM — за часткою слів
function balanceVerdict(stats: ConversationStats): string {
  const total = stats.me.words + stats.her.words;
  if (!total) return '';
  const myShare = stats.me.words / total;
  if (myShare > 0.65) {
    return '⚖️ Ти пишеш помітно більше за неї. Спробуй коротше і дай їй простір проявити ініціативу.';
  }
  if (myShare < 0.35) {
    return '⚖️ Вона пише більше за тебе, це хороший знак. Не відповідай надто сухо.';
  }
  return '⚖️ Баланс у переписці рівний, так і тримай.';
}

export function formatStats(stats: ConversationStats): string {
  const { me, her } = stats;
  const messages = me.messages + her.messages;
  const words = me.words + her.words;

  return [
    '📊 Статистика переписки',
    '',
    `💬 Повідомлення: я ${me.messages} (${percent(me.messages, messages)}) · вона ${her.messages} (${percent(her.messages, messages)})`,
    `📝 Слова: я ${me.words} (${percent(me.words, words)}) · вона ${her.words} (${percent(her.words, words)})`,
    `📏 Середня довжина: я ${average(me)} сл. · вона ${average(her)} сл.`,
    `❓ Питання: я ${me.questions} · вона ${her.questions}`,
    '',
    balanceVerdict(stats),
  ].join('\n');
}

export function formatInterest(analysis: InterestAnalysis): string {
  const { interest, summary, positive, negative, advice } = analysis;
  const filled = Math.round(interest / 10);
  const icon = interest < 35 ? '🥶' : interest < 65 ? '🙂' : '🔥';

  const lines = [
    `${icon} Зацікавленість: ${interest}/100`,
    '▰'.repeat(filled) + '▱'.repeat(10 - filled),
  ];
  if (summary) lines.push('', summary);
  if (positive.length) {
    lines.push('', '✅ Що добре:', ...positive.map((p) => `• ${p}`));
  }
  if (negative.length) {
    lines.push('', '⚠️ Що насторожує:', ...negative.map((n) => `• ${n}`));
  }
  if (advice) lines.push('', `💡 Порада: ${advice}`);
  return lines.join('\n');
}
