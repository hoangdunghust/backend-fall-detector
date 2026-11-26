/** Tên sự kiện nội bộ (EventEmitter2). */
export const EVT = {
  // Từ MQTT
  DEVICE_EVENT: 'mqtt.event',
  HEARTBEAT: 'mqtt.heartbeat',
  STATUS: 'mqtt.status',
  INFO: 'mqtt.info',
  SMS: 'mqtt.sms',
  CMD_RESP: 'mqtt.cmdresp',
  // Từ ứng dụng (đẩy tới WebSocket)
  INCIDENT_CREATED: 'app.incident.created',
  INCIDENT_UPDATED: 'app.incident.updated',
  DEVICE_STATE: 'app.device.state',
  LOCATION_UPDATED: 'app.location.updated',
  CONTACTS_UPDATED: 'app.contacts.updated',
} as const;

export interface DeviceMsg<T> {
  receivedAt: Date;
  retained: boolean;
  payload: T;
}
