/**
 * Hợp đồng topic với firmware (1 thiết bị).
 *   Thiết bị -> BE : v2/device/<id>/{event,heartbeat,status/sms}, device/<id>/{status,info,cmd/resp}
 *   BE -> thiết bị : v2/device/<id>/command (KHÔNG retain), v2/device/<id>/config/emergency_contacts (retain)
 * BE subscribe ĐÚNG các topic cụ thể (không wildcard) nên không nhận bản trùng từ alert/* legacy.
 */
export const DEVICE_ID_REGEX = /^esp_[0-9a-f]{12}$/;

export type TopicKind = 'event' | 'heartbeat' | 'sms' | 'status' | 'info' | 'cmdresp';

export interface DeviceTopics {
  readonly subscribe: string[];
  readonly commandTopic: string;
  readonly contactsConfigTopic: string;
  kindOf(topic: string): TopicKind | null;
}

export function buildTopics(deviceId: string): DeviceTopics {
  if (!DEVICE_ID_REGEX.test(deviceId)) {
    throw new Error(`deviceId không hợp lệ: "${deviceId}"`);
  }
  const map = new Map<string, TopicKind>([
    [`v2/device/${deviceId}/event`, 'event'],
    [`v2/device/${deviceId}/heartbeat`, 'heartbeat'],
    [`v2/device/${deviceId}/status/sms`, 'sms'],
    [`device/${deviceId}/status`, 'status'],
    [`device/${deviceId}/info`, 'info'],
    [`device/${deviceId}/cmd/resp`, 'cmdresp'],
  ]);
  return {
    subscribe: Array.from(map.keys()),
    commandTopic: `v2/device/${deviceId}/command`,
    contactsConfigTopic: `v2/device/${deviceId}/config/emergency_contacts`,
    kindOf: (topic: string) => map.get(topic) ?? null,
  };
}
