import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { EVT } from '../common/events';
import { buildTopics, DeviceTopics } from './topics';
import {
  parseCmdResp,
  parseEvent,
  parseHeartbeat,
  parseInfo,
  parseJsonBuffer,
  parseSms,
  parseStatus,
} from './payloads';

/** Phân loại bản tin MQTT theo topic, kiểm tra payload, rồi phát sự kiện nội bộ. */
@Injectable()
export class MqttRouterService {
  private readonly logger = new Logger(MqttRouterService.name);
  private readonly topics: DeviceTopics;

  constructor(
    @Inject(APP_CONFIG) cfg: AppConfig,
    private readonly emitter: EventEmitter2,
  ) {
    this.topics = buildTopics(cfg.deviceId);
  }

  get subscriptions(): string[] {
    return this.topics.subscribe;
  }

  route(topic: string, payload: Buffer, retained: boolean): void {
    const kind = this.topics.kindOf(topic);
    if (!kind) {
      this.logger.debug(`Bỏ qua topic lạ: ${topic}`);
      return;
    }
    const json = parseJsonBuffer(payload);
    if (json === null) {
      this.logger.warn(`Payload không phải JSON hợp lệ trên ${topic}`);
      return;
    }
    const receivedAt = new Date();

    switch (kind) {
      case 'event': {
        // Sự kiện cảnh báo không bao giờ retain; bản retain là cũ/giả -> bỏ qua
        if (retained) {
          this.logger.warn('Bỏ qua event retained (không hợp lệ)');
          return;
        }
        const p = parseEvent(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.DEVICE_EVENT, { receivedAt, retained, payload: p });
        return;
      }
      case 'heartbeat': {
        const p = parseHeartbeat(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.HEARTBEAT, { receivedAt, retained, payload: p });
        return;
      }
      case 'status': {
        const p = parseStatus(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.STATUS, { receivedAt, retained, payload: p });
        return;
      }
      case 'info': {
        const p = parseInfo(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.INFO, { receivedAt, retained, payload: p });
        return;
      }
      case 'sms': {
        const p = parseSms(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.SMS, { receivedAt, retained, payload: p });
        return;
      }
      case 'cmdresp': {
        const p = parseCmdResp(json);
        if (!p) return this.invalid(topic);
        this.emitter.emit(EVT.CMD_RESP, { receivedAt, retained, payload: p });
        return;
      }
    }
  }

  private invalid(topic: string): void {
    this.logger.warn(`Payload sai định dạng trên ${topic}`);
  }
}
