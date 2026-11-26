import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  imports: [MqttModule, NotificationsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
