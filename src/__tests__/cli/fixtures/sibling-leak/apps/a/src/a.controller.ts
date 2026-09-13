import { Controller, Get } from '@nestjs/common';

@Controller('a')
export class AController {
  @Get()
  findAll() {}
}
