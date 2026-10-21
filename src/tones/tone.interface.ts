export interface Tone {
  key: string;
  label: string;
  prompt: string;
  // Зразки реплік — модель краще ловить стиль з прикладів, ніж з опису
  examples: string[];
}
