import { createCanvas } from '@napi-rs/canvas';
import { ConversationStats } from '../session/session.types';

const WIDTH = 800;
const HEIGHT = 520;
const FONT = '"Noto Sans", "DejaVu Sans", "Liberation Sans", sans-serif';

const COLORS = {
  background: '#1E1F26',
  text: '#F2F2F5',
  muted: '#9A9CA8',
  grid: '#2E303A',
  me: '#4F8BFF',
  her: '#FF5C8A',
};

// Два стовпчики: зліва я, справа вона — частка повідомлень у переписці
export function renderContributionChart(stats: ConversationStats): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 32px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Хто скільки пише', WIDTH / 2, 60);

  const total = stats.me.messages + stats.her.messages;
  // Вищий стовпчик займає всю висоту — так різниця помітніша
  const maxMessages = Math.max(stats.me.messages, stats.her.messages, 1);
  const baseY = 410;
  const maxBarHeight = 270;
  const barWidth = 170;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, baseY);
  ctx.lineTo(WIDTH - 120, baseY);
  ctx.stroke();

  const bars = [
    { label: 'Я', side: stats.me, color: COLORS.me, x: 270 },
    { label: 'Вона', side: stats.her, color: COLORS.her, x: 530 },
  ];

  for (const { label, side, color, x } of bars) {
    const share = total ? side.messages / total : 0;
    const height = Math.max(
      (side.messages / maxMessages) * maxBarHeight,
      side.messages ? 6 : 0,
    );
    const top = baseY - height;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - barWidth / 2, top, barWidth, height, [14, 14, 0, 0]);
    ctx.fill();

    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillText(`${Math.round(share * 100)}%`, x, top - 16);

    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(label, x, baseY + 42);

    ctx.fillStyle = COLORS.muted;
    ctx.font = `22px ${FONT}`;
    ctx.fillText(
      `${side.messages} повідомл. · ${side.words} сл.`,
      x,
      baseY + 76,
    );
  }

  return canvas.toBuffer('image/png');
}
