import { Module } from '@nestjs/common';
import { DocfyModule } from 'nestjs-docfy';
import { UsersController } from './users/users.controller';

@Module({
  imports: [DocfyModule.forRoot()],
  controllers: [UsersController],
})
export class AppModule {}
