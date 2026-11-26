import { Global, Module } from '@nestjs/common';
import { loadConfig } from './app-config';
import { APP_CONFIG } from './tokens';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
