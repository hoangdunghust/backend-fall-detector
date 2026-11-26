import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WatchdogService } from './watchdog.service';

@Module({
  imports: [DeviceModule, NotificationsModule],
  providers: [WatchdogService],
})
export class WatchdogModule {}
