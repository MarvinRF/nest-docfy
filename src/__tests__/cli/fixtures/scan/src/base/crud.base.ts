import { Controller, Get } from '@nestjs/common';

@Controller()
export class CrudBase {
  @Get()
  findAll(): string[] {
    return [];
  }
}
