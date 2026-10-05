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

export interface ImageMedia {
  fileId: string;
  // Однаковий для того самого файлу — щоб не описувати популярний стікер щоразу
  uniqueId: string;
  size?: number;
  // Як назвати в описі: «[фото: …]», «[стікер 😂: …]»
  label: string;
}

// Telegram стискає фото в кілька розмірів — більше за це моделі не потрібно
const MAX_PHOTO_SIDE = 1280;

type Thumb = { file_id: string; file_unique_id: string; file_size?: number };

function fromThumb(thumb: Thumb | undefined, label: string) {
  if (!thumb) return undefined;
  return {
    fileId: thumb.file_id,
    uniqueId: thumb.file_unique_id,
    size: thumb.file_size,
    label,
  };
}

// Фото, стікери, гіфки й відео — те, що можна показати vision-моделі
export function extractImage(
  message: Message | undefined,
): ImageMedia | undefined {
  if (!message) return undefined;
  if ('photo' in message) {
    const sizes = message.photo;
    const photo =
      sizes
        .filter((p) => Math.max(p.width, p.height) <= MAX_PHOTO_SIDE)
        .at(-1) ?? sizes[0];
    return {
      fileId: photo.file_id,
      uniqueId: photo.file_unique_id,
      size: photo.file_size,
      label: 'фото',
    };
  }
  if ('sticker' in message) {
    const { sticker } = message;
    const label = `стікер ${sticker.emoji ?? ''}`.trim();
    // Анімовані (.tgs) і відеостікери модель не прочитає — беремо їхнє прев'ю
    if (sticker.is_animated || sticker.is_video) {
      return fromThumb(sticker.thumbnail, label);
    }
    return {
      fileId: sticker.file_id,
      uniqueId: sticker.file_unique_id,
      size: sticker.file_size,
      label,
    };
  }
  if ('animation' in message) {
    return fromThumb(message.animation.thumbnail, 'гіфка');
  }
  if ('video' in message) return fromThumb(message.video.thumbnail, 'відео');
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
