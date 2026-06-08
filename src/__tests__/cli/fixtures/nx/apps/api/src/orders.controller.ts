import { Controller, Get, Post, Param, Body } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
  @Get()
  findAll(): string[] { return []; }

  @Post()
  create(@Body() body: unknown): unknown { return body; }
}
