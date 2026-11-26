import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs from 'fs';
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { MqttRouterService } from './mqtt-router.service';

export interface PublishOptions {
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** Cửa duy nhất vào/ra broker. Không chặn khởi động nếu broker chưa sẵn sàng (tự nối lại). */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  private connected = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly router: MqttRouterService,
  ) {}

  onModuleInit(): void {
    const c = this.cfg.mqtt;
    const opts: IClientOptions = {
      clientId: c.clientId,
      username: c.username,
      password: c.password,
      clean: true,
      resubscribe: false, // tự subscribe lại trong handler 'connect'
      keepalive: 60,
      connectTimeout: 15_000,
      reconnectPeriod: 3_000,
    };
    if (c.caPath) opts.ca = fs.readFileSync(c.caPath);

    this.logger.log(`Kết nối MQTT ${c.url} (clientId=${c.clientId})`);
    const client = connect(c.url, opts);
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.logger.log('MQTT đã kết nối');
      this.subscribeAll(client);
    });
    client.on('close', () => {
      if (this.connected) this.logger.warn('MQTT mất kết nối, đang thử lại...');
      this.connected = false;
    });
    client.on('error', (err: Error) => this.logger.error(`MQTT lỗi: ${err.message}`));
    client.on('message', (topic: string, payload: Buffer, packet: { retain?: boolean }) => {
      try {
        this.router.route(topic, payload, packet?.retain === true);
      } catch (e) {
        this.logger.error(`Lỗi xử lý bản tin ${topic}: ${(e as Error).message}`);
      }
    });
  }

  private subscribeAll(client: MqttClient): void {
    client.subscribe(
      this.router.subscriptions,
      { qos: 1 },
      (err: Error | null, granted?: Array<{ topic: string; qos: number }>) => {
        if (err) {
          this.logger.error(`Subscribe thất bại: ${err.message}`);
          return;
        }
        for (const g of granted ?? []) {
          // qos 128 = broker từ chối (thường do ACL)
          if (g.qos === 128) this.logger.error(`Broker TỪ CHỐI subscribe ${g.topic} (kiểm tra ACL của tài khoản BE)`);
        }
        this.logger.log(`Đã subscribe ${this.router.subscriptions.length} topic`);
      },
    );
  }

  isConnected(): boolean {
    return this.connected;
  }

  publish(topic: string, payload: object | string, opts: PublishOptions): Promise<void> {
    const client = this.client;
    if (!client || !this.connected) {
      return Promise.reject(new ServiceUnavailableException('MQTT broker chưa kết nối'));
    }
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Promise<void>((resolve, reject) => {
      client.publish(topic, body, { qos: opts.qos, retain: opts.retain }, (err?: Error) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    if (!client) return;
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
  }
}
