import { Controller, Get } from '@nestjs/common';

@Controller('b')
export class BController {
  @Get()
  findAll() {}
}
