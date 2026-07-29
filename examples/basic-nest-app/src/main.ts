import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyDocfyMetadata, DocfyUiModule } from 'nestjs-docfy';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('basic-nest-app')
    .setDescription('nestjs-docfy demo — see the README for the three ways this app gets fully patched Swagger docs')
    .setVersion('1.0')
    .addServer('http://localhost:3000')
    .build();

  let document = SwaggerModule.createDocument(app, config);

  // This app builds with "webpack": true (see nest-cli.json) — DocfyModule's
  // runtime require.cache-based discovery (registered above, in
  // AppModule) cannot apply docs files inside a webpack bundle, so it logs a
  // warning per controller and moves on. The CLI plugin (also registered in
  // nest-cli.json's compilerOptions.plugins) precomputes the same patch at
  // build time instead and writes it to docfy-metadata.json; this line reads
  // that file and merges it in. Safe to call unconditionally: under a plain
  // `tsc` build (no webpack), DocfyModule already applied everything, and
  // re-merging the same patch on top is a harmless no-op.
  document = applyDocfyMetadata(document);

  SwaggerModule.setup('docs', app, document);
  DocfyUiModule.setup('/docs-ui', app, { openApiDocument: document });

  await app.listen(3000);
  // eslint-disable-next-line no-console
  console.log('Swagger UI: http://localhost:3000/docs');
  // eslint-disable-next-line no-console
  console.log('docfy-ui (Try it out): http://localhost:3000/docs-ui');
}
bootstrap();
