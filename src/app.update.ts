import { Ctx, On, Start, Update } from "nestjs-telegraf";
import { Context } from "telegraf";

@Update()
export class ChattingBotUpdate {

  @Start()
  async handleStart(@Ctx() context: Context) {
    await context.reply("This Bot is already started!")
  }

  @On("text")
  async handleIncomingMessage(@Ctx() context: Context) {
    if (!context.message || !('text' in context.message)) {
      throw new Error()
    }

    const text: string = context.message.text

    console.log(text)
  }

}