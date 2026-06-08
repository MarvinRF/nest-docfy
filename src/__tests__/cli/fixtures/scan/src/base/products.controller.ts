import { Controller, Post, Body } from '@nestjs/common';
import { CrudBase } from './crud.base';

@Controller('products')
export class ProductsController extends CrudBase {
  @Post()
  create(@Body() body: unknown): unknown {
    return body;
  }
}
