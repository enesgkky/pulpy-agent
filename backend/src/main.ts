import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  if (configService.get<string>('NODE_ENV') === 'development') {
    app.enableCors();
  }

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port);
}
bootstrap();
