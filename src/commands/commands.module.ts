import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';

@Module({
  imports: [MqttModule, DeviceModule],
  controllers: [CommandsController],
  providers: [CommandsService],
})
export class CommandsModule {}
