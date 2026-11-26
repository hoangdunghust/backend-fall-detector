import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { NotificationsService } from './notifications.service';
import { PushTokenController } from './push-token.controller';
import { PUSH_PROVIDER } from './notify.types';
import { ConsolePushProvider } from './providers/console.provider';
import { ExpoPushProvider } from './providers/expo.provider';
import { FcmPushProvider } from './providers/fcm.provider';

@Module({
  controllers: [PushTokenController],
  providers: [
    {
      provide: PUSH_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => {
        switch (cfg.notify.provider) {
          case 'expo':
            return new ExpoPushProvider({ accessToken: cfg.notify.expoAccessToken });
          case 'fcm':
            return new FcmPushProvider({
              serviceAccountPath: cfg.notify.firebaseServiceAccountPath,
              serviceAccountJson: cfg.notify.firebaseServiceAccountJson,
            });
          default:
            return new ConsolePushProvider();
        }
      },
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
