import { Module } from '@nestjs/common';
import { MqttRouterService } from './mqtt-router.service';
import { MqttService } from './mqtt.service';

@Module({
  providers: [MqttRouterService, MqttService],
  exports: [MqttService],
})
export class MqttModule {}
