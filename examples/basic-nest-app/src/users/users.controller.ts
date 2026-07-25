import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { WithDocs } from 'nestjs-docfy';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminUserEntity, UserEntity, UserRole } from './entities/user.entity';

// No @nestjs/swagger decorator anywhere in this file — every bit of Swagger
// documentation lives in the companion users.controller.docs.ts instead.
@WithDocs()
@Controller('users')
export class UsersController {
  private readonly users: (UserEntity | AdminUserEntity)[] = [
    { id: '1', name: 'Ada Lovelace', role: UserRole.Member },
    { id: '2', name: 'Alan Turing', role: UserRole.Admin, permissions: ['manage_users'] },
  ];

  @Get()
  findAll(@Query('role') role?: UserRole): UserEntity[] {
    return role ? this.users.filter((u) => u.role === role) : this.users;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<UserEntity | AdminUserEntity> {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return Promise.resolve(user);
  }

  @Post()
  create(@Body() dto: CreateUserDto): UserEntity {
    const user: UserEntity = { id: String(this.users.length + 1), name: dto.name, role: dto.role };
    this.users.push(user);
    return user;
  }
}
