import { Controller, Get } from '@nestjs/common';

// Безкоштовний Render присипляє сервіс без вхідних запитів —
// зовнішній пінгер стукає сюди, щоб бот не засинав
@Controller()
export class HealthController {
  @Get(['/', 'health'])
  health() {
    return 'ok';
  }
}
