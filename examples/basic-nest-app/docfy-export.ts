import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyDocfyMetadata } from 'nestjs-docfy';
import { AppModule } from './src/app.module';

// Entry file for `nestjs-docfy export` (see README's "CLI: export" section)
// — same setup as src/main.ts, minus `.listen()`/DocfyUiModule, used by CI to
// produce the OpenAPI document for the PR-check bot's breaking-change diff.
export default async function () {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('basic-nest-app')
    .setDescription('nestjs-docfy demo — see the README for the three ways this app gets fully patched Swagger docs')
    .setVersion('1.0')
    .addServer('http://localhost:3000')
    .build();

  let document = SwaggerModule.createDocument(app, config);
  document = applyDocfyMetadata(document);

  return { app, document };
}
