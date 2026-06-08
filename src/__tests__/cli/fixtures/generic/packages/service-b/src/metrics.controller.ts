import { Controller, Get } from '@nestjs/common';

@Controller('metrics')
export class MetricsController {
  @Get()
  get(): string { return ''; }
}
