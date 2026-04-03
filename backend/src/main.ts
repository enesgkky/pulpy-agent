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
  const server = await app.listen(port);

  // Increase timeouts for long-running agent streams
  server.setTimeout(600_000);       // 10 minutes
  server.keepAliveTimeout = 620_000; // slightly above setTimeout
}
bootstrap();
