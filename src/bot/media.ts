import type { Message } from 'telegraf/types';

export interface AudioMedia {
  fileId: string;
  size?: number;
  fileName: string;
}

// Голосові, кружечки та аудіофайли — все, що можна розшифрувати
export function extractAudio(
  message: Message | undefined,
): AudioMedia | undefined {
  if (!message) return undefined;
  if ('voice' in message) {
    const { file_id, file_size } = message.voice;
    return { fileId: file_id, size: file_size, fileName: 'voice.ogg' };
  }
  if ('video_note' in message) {
    const { file_id, file_size } = message.video_note;
    return { fileId: file_id, size: file_size, fileName: 'video.mp4' };
  }
  if ('audio' in message) {
    const { file_id, file_size, file_name } = message.audio;
    return {
      fileId: file_id,
      size: file_size,
      fileName: file_name ?? 'audio.mp3',
    };
  }
  return undefined;
}

// Для повідомлень без тексту — короткий опис, щоб модель розуміла, що прийшло
export function describeNonText(message: Message): string | undefined {
  if ('sticker' in message)
    return `[стікер ${message.sticker.emoji ?? ''}]`.trim();
  if ('photo' in message) return '[фото]';
  if ('video' in message) return '[відео]';
  if ('animation' in message) return '[гіфка]';
  if ('document' in message) return '[файл]';
  return undefined;
}
