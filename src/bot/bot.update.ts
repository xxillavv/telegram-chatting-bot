import { OnModuleInit } from '@nestjs/common';
import {
  Action,
  Command,
  Ctx,
  Hears,
  InjectBot,
  On,
  Start,
  Update,
} from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';

type ForwardOrigin = Message.TextMessage['forward_origin'];
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../ai/speech.service';
import { SessionService } from '../session/session.service';
import { DEFAULT_TONE, findTone } from '../tones/tones';
import { BATCH_DELAY_MS, COMMANDS, HELP, MENU } from './bot.constants';
import {
  cancelKeyboard,
  mainMenu,
  questionKeyboard,
  questionsKeyboard,
  replyKeyboard,
  resetConfirmKeyboard,
  settingsKeyboard,
  toneKeyboard,
} from './bot.keyboards';

// Telegram не віддає ботам файли, більші за 20 МБ
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ABOUT_PROMPT =
  "Розкажи про неї і ваше спілкування: ім'я, вік, як познайомились, спільні теми, що варто знати. Наступне повідомлення я збережу як контекст.";
const CUSTOM_TONE_PROMPT =
  'Опиши, як мені писати. Наприклад: «стримано, трохи загадково, без емодзі, на "ви"»';

@Update()
export class BotUpdate implements OnModuleInit {
  private readonly timers = new Map<number, NodeJS.Timeout>();

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly sessions: SessionService,
    private readonly ai: AiService,
    private readonly speech: SpeechService,
  ) {}

  // Список команд для синьої кнопки «Меню» поруч із полем вводу
  async onModuleInit() {
    await this.bot.telegram.setMyCommands(COMMANDS);
  }

  @Start()
  async start(@Ctx() ctx: Context) {
    this.clearInput(ctx);
    await ctx.reply(`Привіт! 👋\n\n${HELP}`, mainMenu);
  }

  @Command('help')
  async helpCommand(@Ctx() ctx: Context) {
    await this.showHelp(ctx);
  }

  @Hears(MENU.help)
  async helpButton(@Ctx() ctx: Context) {
    await this.showHelp(ctx);
  }

  @Command('questions')
  async questionsCommand(@Ctx() ctx: Context) {
    await this.showQuestions(ctx);
  }

  @Hears(MENU.questions)
  async questionsButton(@Ctx() ctx: Context) {
    await this.showQuestions(ctx);
  }

  @Action('more_questions')
  async moreQuestions(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.showQuestions(ctx);
  }

  @Action(/^question:(\d+)$/)
  async pickQuestion(@Ctx() ctx: Context & { match: RegExpExecArray }) {
    const session = this.sessions.get(ctx.chat!.id);
    const question = session.questions?.[Number(ctx.match[1])];
    if (!question) return ctx.answerCbQuery('Ці питання вже застаріли');
    // Як і звичайна відповідь: коли вона відповість, питання піде в історію
    session.draft = question;
    await ctx.answerCbQuery();
    await ctx.reply(question, questionKeyboard);
  }

  @Command('tone')
  async toneCommand(@Ctx() ctx: Context) {
    await this.showTones(ctx);
  }

  @Hears(MENU.tone)
  async toneButton(@Ctx() ctx: Context) {
    await this.showTones(ctx);
  }

  @Action('open_tone')
  async toneInline(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.showTones(ctx);
  }

  @Action(/^tone:(.+)$/)
  async setTone(@Ctx() ctx: Context & { match: RegExpExecArray }) {
    const tone = findTone(ctx.match[1]);
    if (!tone) return ctx.answerCbQuery('Невідомий тон');
    const session = this.sessions.get(ctx.chat!.id);
    session.toneKey = tone.key;
    session.customTone = undefined;
    await ctx.answerCbQuery(`Тон: ${tone.label}`);
    await ctx.editMessageText(`Тон: ${tone.label} ✅`);
  }

  @Action('custom_tone')
  async customTone(@Ctx() ctx: Context) {
    this.sessions.get(ctx.chat!.id).awaiting = 'tone';
    await ctx.answerCbQuery();
    await ctx.reply(CUSTOM_TONE_PROMPT, cancelKeyboard);
  }

  @Command('about')
  async aboutCommand(@Ctx() ctx: Context) {
    await this.askAbout(ctx);
  }

  @Hears(MENU.about)
  async aboutButton(@Ctx() ctx: Context) {
    await this.askAbout(ctx);
  }

  @Action('open_about')
  async aboutInline(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.askAbout(ctx);
  }

  @Action('clear_about')
  async clearAbout(@Ctx() ctx: Context) {
    this.sessions.get(ctx.chat!.id).about = undefined;
    await ctx.answerCbQuery('Контекст видалено');
    await ctx.editMessageText(
      this.settingsText(ctx),
      settingsKeyboard(this.sessions.get(ctx.chat!.id)),
    );
  }

  @Action('cancel_input')
  async cancelInput(@Ctx() ctx: Context) {
    this.clearInput(ctx);
    await ctx.answerCbQuery('Скасовано');
    await ctx.deleteMessage();
  }

  @Command('settings')
  async settingsCommand(@Ctx() ctx: Context) {
    await this.showSettings(ctx);
  }

  @Hears(MENU.settings)
  async settingsButton(@Ctx() ctx: Context) {
    await this.showSettings(ctx);
  }

  @Hears(MENU.emoji)
  async emojiButton(@Ctx() ctx: Context) {
    this.clearInput(ctx);
    const session = this.toggleEmoji(ctx);
    await ctx.reply(
      session.emoji
        ? '😀 Емодзі увімкнено — іноді додаватиму їх у відповіді'
        : '🚫 Емодзі вимкнено — тільки текст',
    );
  }

  @Action('toggle_emoji')
  async emojiInline(@Ctx() ctx: Context) {
    const session = this.toggleEmoji(ctx);
    await ctx.answerCbQuery(
      session.emoji ? 'Емодзі увімкнено' : 'Емодзі вимкнено',
    );
    await ctx.editMessageText(
      this.settingsText(ctx),
      settingsKeyboard(session),
    );
  }

  @Command('reset')
  async resetCommand(@Ctx() ctx: Context) {
    await this.askReset(ctx);
  }

  @Hears(MENU.reset)
  async resetButton(@Ctx() ctx: Context) {
    await this.askReset(ctx);
  }

  @Action('reset_confirm')
  async resetConfirm(@Ctx() ctx: Context) {
    this.sessions.resetHistory(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      'Історію переписки очищено 🧹 Тон і контекст залишились.',
    );
  }

  @Action('reset_cancel')
  async resetCancel(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Скасовано');
    await ctx.deleteMessage();
  }

  @Action('edit_reply')
  async editReply(@Ctx() ctx: Context) {
    const message = ctx.callbackQuery?.message;
    if (!message || !('text' in message)) return ctx.answerCbQuery();
    const session = this.sessions.get(ctx.chat!.id);
    session.awaiting = 'edit';
    session.editTarget = message.text;
    await ctx.answerCbQuery();
    await ctx.reply(
      `Надішли, як би ти написав (текстом або голосовим). Натисни на текст нижче, щоб скопіювати:\n\n<code>${escapeHtml(message.text)}</code>`,
      { parse_mode: 'HTML', ...cancelKeyboard },
    );
  }

  @Action('clear_style')
  async clearStyle(@Ctx() ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.styleEdits = [];
    await ctx.answerCbQuery('Стиль скинуто');
    await ctx.editMessageText(
      this.settingsText(ctx),
      settingsKeyboard(session),
    );
  }

  @Action('regen')
  async regen(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.generate(
      ctx.chat!.id,
      ctx,
      'Дай інший варіант, не схожий на попередній.',
    );
  }

  @Action('shorter')
  async shorter(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.generate(
      ctx.chat!.id,
      ctx,
      'Зроби відповідь коротшою і простішою.',
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    if (!ctx.message || !('text' in ctx.message)) return;
    await this.handleIncoming(
      ctx,
      ctx.message.text,
      ctx.message.forward_origin,
    );
  }

  // Голосові, кружечки та аудіофайли — розшифровуємо і далі обробляємо як текст
  @On(['voice', 'video_note', 'audio'])
  async onVoice(@Ctx() ctx: Context) {
    const media = this.extractMedia(ctx.message);
    if (!media) return;

    if (media.size && media.size > MAX_AUDIO_BYTES) {
      await ctx.reply('Файл завеликий, максимум 20 МБ 🙏');
      return;
    }

    await ctx.sendChatAction('typing');
    let text: string;
    try {
      const url = await ctx.telegram.getFileLink(media.fileId);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Telegram file: ${response.status}`);
      const audio = Buffer.from(await response.arrayBuffer());
      text = await this.speech.transcribe(audio, media.fileName);
    } catch (error) {
      console.error(error);
      await ctx.reply('Не вдалося розпізнати голосове, спробуй ще раз 🙏');
      return;
    }

    if (!text) {
      await ctx.reply('Не розчув, у голосовому тиша 🤷');
      return;
    }

    await ctx.reply(`🎤 ${text}`);
    const origin = (ctx.message as Message.VoiceMessage).forward_origin;
    await this.handleIncoming(ctx, text, origin);
  }

  private extractMedia(message: Context['message']) {
    if (!message) return undefined;
    if ('voice' in message) {
      const { file_id, file_size } = (message as Message.VoiceMessage).voice;
      return { fileId: file_id, size: file_size, fileName: 'voice.ogg' };
    }
    if ('video_note' in message) {
      const { file_id, file_size } = (message as Message.VideoNoteMessage)
        .video_note;
      return { fileId: file_id, size: file_size, fileName: 'video.mp4' };
    }
    if ('audio' in message) {
      const { file_id, file_size, file_name } = (
        message as Message.AudioMessage
      ).audio;
      return {
        fileId: file_id,
        size: file_size,
        fileName: file_name ?? 'audio.mp3',
      };
    }
    return undefined;
  }

  private async handleIncoming(
    ctx: Context,
    text: string,
    origin: ForwardOrigin,
  ) {
    const chatId = ctx.chat!.id;
    const session = this.sessions.get(chatId);

    if (session.awaiting === 'edit') {
      this.applyEdit(chatId, text);
      await ctx.reply(
        "Запам'ятав ✅ Наступні відповіді писатиму ближче до твого стилю.",
      );
      return;
    }

    if (session.awaiting) {
      if (session.awaiting === 'tone') session.customTone = text;
      else session.about = text;
      session.awaiting = undefined;
      await ctx.reply('Збережено ✅');
      return;
    }

    const forwardedFromMe =
      origin?.type === 'user' && origin.sender_user.id === ctx.from?.id;
    const mineManual = /^я\s*:/i.exec(text);

    if (forwardedFromMe || mineManual) {
      // Він переслав свою справжню відповідь — вона замінює нашу чернетку
      // і заразом показує, як він пише насправді
      const mine = mineManual ? text.slice(mineManual[0].length).trim() : text;
      if (session.draft) {
        this.sessions.addStyleEdit(chatId, {
          before: session.draft,
          after: mine,
        });
      }
      session.draft = undefined;
      this.sessions.addLine(chatId, {
        from: 'me',
        text: mine,
      });
      return;
    }

    // Вона відповіла — отже, нашу останню чернетку він відправив
    if (session.draft) {
      this.sessions.addLine(chatId, { from: 'me', text: session.draft });
      session.draft = undefined;
    }
    this.sessions.addLine(chatId, { from: 'her', text });

    clearTimeout(this.timers.get(chatId));
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        void this.generate(chatId, ctx);
      }, BATCH_DELAY_MS),
    );
  }

  private async showHelp(ctx: Context) {
    this.clearInput(ctx);
    await ctx.reply(HELP, mainMenu);
  }

  private async showQuestions(ctx: Context) {
    this.clearInput(ctx);
    const session = this.sessions.get(ctx.chat!.id);
    await ctx.sendChatAction('typing');
    try {
      const questions = await this.ai.generateQuestions(session);
      session.questions = questions;
      const list = questions.map((q, i) => `${i + 1}. ${q}`).join('\n\n');
      await ctx.reply(
        `💬 Питання, щоб розрядити паузу:\n\n${list}\n\nОбери, яке взяти:`,
        questionsKeyboard(questions.length),
      );
    } catch (error) {
      console.error(error);
      await ctx.reply('Не вдалося придумати питання, спробуй ще раз 🙏');
    }
  }

  private async showTones(ctx: Context) {
    this.clearInput(ctx);
    const session = this.sessions.get(ctx.chat!.id);
    await ctx.reply('Обери тон спілкування:', toneKeyboard(session));
  }

  private async askAbout(ctx: Context) {
    this.sessions.get(ctx.chat!.id).awaiting = 'about';
    await ctx.reply(ABOUT_PROMPT, cancelKeyboard);
  }

  private async showSettings(ctx: Context) {
    this.clearInput(ctx);
    await ctx.reply(
      this.settingsText(ctx),
      settingsKeyboard(this.sessions.get(ctx.chat!.id)),
    );
  }

  private async askReset(ctx: Context) {
    this.clearInput(ctx);
    const { history } = this.sessions.get(ctx.chat!.id);
    if (!history.length) {
      await ctx.reply('Переписка й так порожня 🙂');
      return;
    }
    await ctx.reply(
      `Очистити історію (${history.length} повідомлень)? Тон і контекст залишаться.`,
      resetConfirmKeyboard,
    );
  }

  private applyEdit(chatId: number, after: string) {
    const session = this.sessions.get(chatId);
    const before = session.editTarget!;
    session.awaiting = undefined;
    session.editTarget = undefined;
    this.sessions.addStyleEdit(chatId, { before, after });

    // Виправлений варіант замінює оригінал — і в чернетці, і в історії
    if (session.draft === before) {
      session.draft = after;
    } else {
      const line = session.history.findLast(
        (l) => l.from === 'me' && l.text === before,
      );
      if (line) line.text = after;
    }
  }

  private toggleEmoji(ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.emoji = !session.emoji;
    return session;
  }

  private settingsText(ctx: Context): string {
    const session = this.sessions.get(ctx.chat!.id);
    const tone = session.customTone
      ? `✍️ ${session.customTone}`
      : (findTone(session.toneKey) ?? DEFAULT_TONE).label;
    return `⚙️ Налаштування\n\nТон: ${tone}\nЕмодзі: ${session.emoji ? 'увімк' : 'вимк'}\nКонтекст: ${session.about ?? '—'}\nПравок мого стилю: ${session.styleEdits.length}\nПовідомлень в історії: ${session.history.length}`;
  }

  // Якщо бот чекав на введення тону чи контексту, а користувач пішов у меню — забуваємо про це
  private clearInput(ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.awaiting = undefined;
    session.editTarget = undefined;
  }

  private async generate(chatId: number, ctx: Context, hint?: string) {
    const session = this.sessions.get(chatId);
    if (!session.history.some((line) => line.from === 'her')) {
      await ctx.reply('Спершу перешли її повідомлення 🙂');
      return;
    }

    await ctx.sendChatAction('typing');
    try {
      const reply = await this.ai.generateReply(session, hint);
      session.draft = reply;
      await ctx.reply(reply, replyKeyboard);
    } catch (error) {
      console.error(error);
      await ctx.reply('Не вдалося згенерувати відповідь, спробуй ще раз 🙏');
    }
  }
}
