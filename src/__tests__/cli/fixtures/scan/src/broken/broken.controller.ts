import { Controller } from '@nestjs/common';

@Controller('broken')
export class BrokenController {
  // intentionally valid TS so ts-morph loads it
  // but no HTTP methods — edge case for empty methods
}
