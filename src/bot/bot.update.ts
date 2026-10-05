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
import { AiService } from '../ai/ai.service';
import { SessionService } from '../session/session.service';
import { renderContributionChart } from '../stats/stats.chart';
import { formatInterest, formatStats } from '../stats/stats.text';
import { DEFAULT_TONE, findTone } from '../tones/tones';
import { COMMANDS, HELP, MENU } from './bot.constants';
import {
  cancelKeyboard,
  chatKeyboard,
  factsKeyboard,
  mainMenu,
  questionKeyboard,
  questionsKeyboard,
  replyKeyboard,
  resetConfirmKeyboard,
  settingsKeyboard,
  toneKeyboard,
} from './bot.keyboards';
import { AUTO_SEND_SECONDS } from './auto-send';
import { ConversationService } from './conversation.service';
import { extractAudio } from './media';

type ForwardOrigin = Message.TextMessage['forward_origin'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Менше — і LLM нема з чого робити висновки про зацікавленість
const MIN_HER_MESSAGES_FOR_ANALYSIS = 3;

const ABOUT_PROMPT =
  "Розкажи про неї і ваше спілкування: ім'я, вік, як познайомились, спільні теми, що варто знати. Наступне повідомлення я збережу як контекст.";
const LINK_PROMPT =
  'Введи @username дівчини, за чиїм чатом стежити. Якщо юзернейму нема, просто перешли мені будь-яке її повідомлення.';
const CUSTOM_TONE_PROMPT =
  'Опиши, як мені писати. Наприклад: «стримано, трохи загадково, без емодзі, на "ви"»';

@Update()
export class BotUpdate implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly sessions: SessionService,
    private readonly ai: AiService,
    private readonly conversation: ConversationService,
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
    const sent = await ctx.reply(
      question,
      questionKeyboard(this.conversation.canSend(session)),
    );
    session.draftMessageId = sent.message_id;
  }

  @Command('stats')
  async statsCommand(@Ctx() ctx: Context) {
    await this.showStats(ctx);
  }

  @Hears(MENU.stats)
  async statsButton(@Ctx() ctx: Context) {
    await this.showStats(ctx);
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

  @Action('show_facts')
  async showFacts(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const { facts } = this.sessions.get(ctx.chat!.id);
    if (!facts?.length) {
      await ctx.reply(
        "Поки нічого не запам'ятав. Факти з'являються з переписки.",
      );
      return;
    }
    await ctx.reply(
      `🧠 Що я про неї знаю з переписки:\n\n${facts.map((f) => `• ${f}`).join('\n')}`,
      factsKeyboard,
    );
  }

  @Action('clear_facts')
  async clearFacts(@Ctx() ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.facts = [];
    session.factsPending = 0;
    await ctx.answerCbQuery('Забув');
    await ctx.editMessageText('🧠 Факти про неї видалено.');
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
      'Історію переписки і факти з неї очищено 🧹 Тон і контекст залишились.',
    );
  }

  @Action('reset_cancel')
  async resetCancel(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Скасовано');
    await ctx.deleteMessage();
  }

  @Action('edit_reply')
  async editReply(@Ctx() ctx: Context) {
    // Правка — значить, він не хоче, щоб пішов поточний варіант
    this.conversation.cancelAutoSend(ctx.chat!.id);
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
    await this.conversation.generate(
      ctx.chat!.id,
      'Дай інший варіант, не схожий на попередній.',
    );
  }

  @Action('shorter')
  async shorter(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.conversation.generate(
      ctx.chat!.id,
      'Зроби відповідь коротшою і простішою.',
    );
  }

  @Action('send_reply')
  async sendReply(@Ctx() ctx: Context) {
    const message = ctx.callbackQuery?.message;
    if (!message || !('text' in message)) return ctx.answerCbQuery();
    const session = this.sessions.get(ctx.chat!.id);
    if (!this.conversation.canSend(session)) {
      return ctx.answerCbQuery('Чат не підключено', { show_alert: true });
    }
    if (!this.conversation.isCurrentDraft(ctx.chat!.id, message.text)) {
      await ctx.editMessageReplyMarkup(undefined);
      return ctx.answerCbQuery(
        'Цей варіант уже застарів, бери новіший нижче 👇',
        { show_alert: true },
      );
    }

    // Прибираємо кнопки одразу, щоб не відправити двічі
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.answerCbQuery('Відправляю…');
    try {
      await this.conversation.sendToHer(ctx.chat!.id, message.text);
      await ctx.reply(`✅ Відправлено ${session.linked!.name}`);
    } catch (error) {
      console.error(error);
      await ctx.reply(
        'Не вдалося відправити 🙏 Перевір, що в налаштуваннях чат-бота увімкнено «Відповідати на повідомлення».',
      );
    }
  }

  @Command('chat')
  async chatCommand(@Ctx() ctx: Context) {
    await this.showChat(ctx);
  }

  @Hears(MENU.chat)
  async chatButton(@Ctx() ctx: Context) {
    await this.showChat(ctx);
  }

  @Action(/^link:(-?\d+)$/)
  async linkChat(@Ctx() ctx: Context & { match: RegExpExecArray }) {
    const session = this.sessions.get(ctx.chat!.id);
    const chatId = Number(ctx.match[1]);
    const name = session.seenChats[chatId];
    if (!name) return ctx.answerCbQuery('Цей чат уже недоступний');

    this.sessions.link(ctx.chat!.id, { chatId, name });
    await ctx.answerCbQuery(`Підключено ${name}`);
    await ctx.editMessageText(
      `🔗 Стежу за чатом з ${name}. Її нові повідомлення прийдуть сюди разом з варіантом відповіді.`,
    );
  }

  @Action('change_chat')
  async changeChat(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.askLink(ctx);
  }

  @Action('auto_stop')
  async autoStop(@Ctx() ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    this.conversation.cancelAutoSend(ctx.chat!.id);
    await ctx.answerCbQuery('Зупинено, відправляй сам');
    await ctx.editMessageReplyMarkup(
      replyKeyboard(this.conversation.canSend(session)).reply_markup,
    );
  }

  @Action('toggle_auto')
  async toggleAuto(@Ctx() ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.autoSend = !session.autoSend;
    if (!session.autoSend) this.conversation.cancelAutoSend(ctx.chat!.id);
    await ctx.answerCbQuery(
      session.autoSend
        ? `Автовідправка увімкнена: ${AUTO_SEND_SECONDS} с, щоб натиснути «Стоп»`
        : 'Автовідправку вимкнено',
    );
    await ctx.editMessageReplyMarkup(
      (ctx.callbackQuery?.message as { text?: string })?.text?.startsWith('⚙️')
        ? settingsKeyboard(session).reply_markup
        : chatKeyboard(session).reply_markup,
    );
  }

  @Action('unlink')
  async unlinkChat(@Ctx() ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.linked = undefined;
    session.pendingLink = undefined;
    session.draft = undefined;
    this.conversation.cancelAutoSend(ctx.chat!.id);
    await ctx.answerCbQuery('Відключено');
    await ctx.editMessageText(
      '🔌 Чат відключено. Повідомлення знову можна пересилати вручну.',
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
    const media = extractAudio(ctx.message);
    if (!media) return;

    await ctx.sendChatAction('typing');
    let text: string;
    try {
      text = await this.conversation.transcribe(media);
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

  private async handleIncoming(
    ctx: Context,
    text: string,
    origin: ForwardOrigin,
  ) {
    const chatId = ctx.chat!.id;
    const session = this.sessions.get(chatId);

    if (session.awaiting === 'link') {
      await this.applyLink(ctx, text, origin);
      return;
    }

    if (session.awaiting === 'edit') {
      this.applyEdit(chatId, text);
      await ctx.reply(
        "Запам'ятав ✅ Наступні відповіді писатиму ближче до твого стилю.",
      );
      const sent = await ctx.reply(
        text,
        replyKeyboard(this.conversation.canSend(session)),
      );
      session.draftMessageId = sent.message_id;
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
      this.conversation.addMine(
        chatId,
        mineManual ? text.slice(mineManual[0].length).trim() : text,
      );
      return;
    }

    // Вона відповіла — отже, нашу останню чернетку він відправив (якщо це не продовження її думки)
    // У Bot API у forward_origin є date, а типи Telegraf 4.16 про це не знають
    const originDate = (origin as { date?: number } | undefined)?.date;
    const writtenAt = originDate ? originDate * 1000 : undefined;
    this.conversation.addHers(chatId, text, false, writtenAt);
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

  private async showChat(ctx: Context) {
    this.clearInput(ctx);
    const session = this.sessions.get(ctx.chat!.id);
    // can_connect_to_business з'явилось у Bot API 7.2, Telegraf 4.16 про нього ще не знає
    const me = (await this.bot.telegram.getMe()) as Awaited<
      ReturnType<Telegraf['telegram']['getMe']>
    > & { can_connect_to_business?: boolean };

    if (!session.business?.enabled) {
      await ctx.reply(
        [
          '🔗 Підключення її чату',
          '',
          'Бот сам бачитиме її повідомлення, а відповіді відправлятиме від твого імені по кнопці «✅ Відправити». Доступу до акаунта бот не отримує, все через офіційний Telegram для бізнесу.',
          '',
          '1. Потрібен Telegram Premium (Telegram для бізнесу входить у нього).',
          '2. Налаштування → Telegram для бізнесу → Чат-боти.',
          `3. Введи @${me.username}.`,
          '4. У «Доступ до чатів» обери «Лише вибрані» і додай її.',
          '5. Увімкни дозвіл «Відповідати на повідомлення».',
          ...(me.can_connect_to_business === false
            ? [
                '',
                `⚠️ Спершу в @BotFather: /mybots → @${me.username} → Bot Settings → Business Mode → Turn on. Без цього Telegram не знайде бота.`,
              ]
            : []),
          '',
          'Потім знову натисни /chat і вкажи її @username.',
        ].join('\n'),
      );
      return;
    }

    const lines = ['🔗 Підключення її чату', ''];
    if (!session.business.canReply) {
      lines.push(
        '⚠️ У бота нема дозволу відповідати, тож кнопки «Відправити» не буде. Увімкни «Відповідати на повідомлення» в налаштуваннях чат-бота.',
        '',
      );
    }
    if (session.pendingLink) {
      lines.push(
        `Чекаю на перше повідомлення в чаті з @${session.pendingLink}, тоді й підключу.`,
      );
    } else if (session.linked) {
      lines.push(`Стежу за чатом з ${session.linked.name} ✅`);
    } else {
      if (lines.length > 2) await ctx.reply(lines.join('\n'));
      await this.askLink(ctx);
      return;
    }
    await ctx.reply(lines.join('\n'), chatKeyboard(session));
  }

  private async askLink(ctx: Context) {
    this.sessions.get(ctx.chat!.id).awaiting = 'link';
    await ctx.reply(LINK_PROMPT, cancelKeyboard);
  }

  // Юзернейм або переслане її повідомлення → чат, за яким стежити
  private async applyLink(ctx: Context, text: string, origin: ForwardOrigin) {
    const chatId = ctx.chat!.id;
    const session = this.sessions.get(chatId);

    if (origin) {
      if (origin.type !== 'user') {
        await ctx.reply(
          'У неї прихований акаунт при пересиланні, тож я не бачу, хто це. Введи її @username.',
          cancelKeyboard,
        );
        return;
      }
      const user = origin.sender_user;
      session.awaiting = undefined;
      this.sessions.link(chatId, { chatId: user.id, name: user.first_name });
      await ctx.reply(`🔗 Стежу за чатом з ${user.first_name} ✅`);
      return;
    }

    const username = /^(?:@|(?:https?:\/\/)?t\.me\/)?([a-z0-9_]{4,32})$/i
      .exec(text.trim())?.[1]
      ?.toLowerCase();
    if (!username) {
      await ctx.reply(
        'Це не схоже на юзернейм. Введи у форматі @username або перешли її повідомлення.',
        cancelKeyboard,
      );
      return;
    }

    session.awaiting = undefined;
    const known = session.seenUsernames?.[username];
    if (known !== undefined) {
      const name = session.seenChats[known] ?? `@${username}`;
      this.sessions.link(chatId, { chatId: known, name });
      await ctx.reply(`🔗 Стежу за чатом з ${name} ✅`);
      return;
    }

    session.pendingLink = username;
    await ctx.reply(
      `Запам'ятав @${username}. Щойно в чаті з нею з'явиться нове повідомлення (від неї чи від тебе), почну стежити.\n\nПереконайся, що її чат є серед вибраних у Налаштування → Telegram для бізнесу → Чат-боти.`,
    );
  }

  private async showStats(ctx: Context) {
    this.clearInput(ctx);
    const session = this.sessions.get(ctx.chat!.id);
    const { me, her } = session.stats;
    if (!me.messages && !her.messages) {
      await ctx.reply(
        'Переписки ще нема. Перешли її повідомлення, і я порахую 🙂',
      );
      return;
    }

    await ctx.sendChatAction('upload_photo');
    await ctx.replyWithPhoto(
      { source: renderContributionChart(session.stats) },
      { caption: formatStats(session.stats) },
    );

    const herLines = session.history.filter((l) => l.from === 'her').length;
    if (herLines < MIN_HER_MESSAGES_FOR_ANALYSIS) {
      await ctx.reply(
        `Щоб оцінити її зацікавленість, потрібно хоча б ${MIN_HER_MESSAGES_FOR_ANALYSIS} її повідомлення.`,
      );
      return;
    }

    await ctx.sendChatAction('typing');
    try {
      const analysis = await this.ai.analyzeInterest(session);
      await ctx.reply(formatInterest(analysis));
    } catch (error) {
      console.error(error);
      await ctx.reply('Не вдалося проаналізувати переписку, спробуй ще раз 🙏');
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
      `Очистити історію (${history.length} повідомлень) і факти про неї з переписки? Тон і контекст залишаться.`,
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
    return `⚙️ Налаштування\n\nТон: ${tone}\nЧат: ${session.linked ? `🔗 ${session.linked.name}` : 'не підключено'}\nАвтовідправка: ${session.autoSend ? 'увімк' : 'вимк'}\nЕмодзі: ${session.emoji ? 'увімк' : 'вимк'}\nКонтекст: ${session.about ?? '—'}\nФактів про неї: ${session.facts?.length ?? 0}\nПравок мого стилю: ${session.styleEdits.length}\nПовідомлень в історії: ${session.history.length}`;
  }

  // Якщо бот чекав на введення тону чи контексту, а користувач пішов у меню — забуваємо про це
  private clearInput(ctx: Context) {
    const session = this.sessions.get(ctx.chat!.id);
    session.awaiting = undefined;
    session.editTarget = undefined;
  }
}
