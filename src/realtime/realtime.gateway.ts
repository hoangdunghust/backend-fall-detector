import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EVT } from '../common/events';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { DeviceService } from '../device/device.service';
import { extractToken } from './extract-token';

const ROOM = 'authenticated';

/**
 * Socket.IO: app kết nối với { auth: { token: <JWT> } }. Chỉ socket đã xác thực mới vào phòng
 * nhận sự kiện: incident.created, incident.updated, device.state, location.updated, contacts.updated
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly device: DeviceService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = extractToken(client);
      if (!token) throw new Error('thiếu token');
      await this.jwt.verifyAsync(token, { secret: this.cfg.auth.jwtSecret });
    } catch {
      client.emit('auth_error', { message: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    client.join(ROOM);
    this.logger.log(`App kết nối realtime (${client.id})`);
    // Gửi ngay ảnh chụp trạng thái hiện tại
    client.emit('device.state', await this.device.getStateView());
  }

  private push(event: string, data: unknown): void {
    this.server?.to(ROOM).emit(event, data);
  }

  @OnEvent(EVT.INCIDENT_CREATED)
  onIncidentCreated(incident: unknown): void {
    this.push('incident.created', incident);
  }

  @OnEvent(EVT.INCIDENT_UPDATED)
  onIncidentUpdated(incident: unknown): void {
    this.push('incident.updated', incident);
  }

  @OnEvent(EVT.DEVICE_STATE)
  onDeviceState(state: unknown): void {
    this.push('device.state', state);
  }

  @OnEvent(EVT.LOCATION_UPDATED)
  onLocationUpdated(location: unknown): void {
    this.push('location.updated', location);
  }

  @OnEvent(EVT.CONTACTS_UPDATED)
  onContactsUpdated(contacts: unknown): void {
    this.push('contacts.updated', contacts);
  }
}
