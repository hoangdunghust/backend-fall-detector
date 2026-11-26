/** Soạn nội dung thông báo (thuần, kiểm thử được). */
import { formatAgeVi } from '../common/time.util';
import { maskPhone } from '../common/phone.util';
import { NotifyMessage } from './notify.types';

export type HealthIssue = 'IMU_FAULT' | 'WEAK_SIGNAL' | 'NO_CONTACTS';

export interface IncidentLike {
  id: string;
  type: 'FALL' | 'HELP_REQUEST';
  confidence: number | null;
  lat: number | null;
  lon: number | null;
  gpsValid: boolean;
  gpsAgeS: number | null;
}

export function mapUrl(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function locationText(i: IncidentLike): string {
  if (i.lat === null || i.lon === null) return 'Chưa có vị trí GPS.';
  const url = mapUrl(i.lat, i.lon);
  if (i.gpsValid) return `Vị trí: ${url}`;
  const age = i.gpsAgeS !== null ? ` (cách đây ${formatAgeVi(i.gpsAgeS)})` : '';
  return `Vị trí cũ${age}: ${url}`;
}

export function buildIncidentMessage(i: IncidentLike): NotifyMessage {
  const data: Record<string, string> = {
    kind: 'INCIDENT',
    incidentId: i.id,
    incidentType: i.type,
  };
  if (i.lat !== null && i.lon !== null) {
    data.lat = String(i.lat);
    data.lon = String(i.lon);
    data.mapUrl = mapUrl(i.lat, i.lon);
  }

  if (i.type === 'FALL') {
    const conf = i.confidence !== null ? ` (độ tin cậy ${Math.round(i.confidence * 100)}%)` : '';
    return {
      level: 'ALERT',
      title: '⚠️ Phát hiện té ngã',
      body: `Thiết bị vừa phát hiện té ngã${conf}. ${locationText(i)}`,
      data,
      collapseKey: `incident-${i.id}`,
    };
  }
  return {
    level: 'ALERT',
    title: '🆘 Yêu cầu trợ giúp (SOS)',
    body: `Người đeo vừa giữ nút SOS. ${locationText(i)}`,
    data,
    collapseKey: `incident-${i.id}`,
  };
}

export function deviceOfflineMessage(timeoutS: number): NotifyMessage {
  return {
    level: 'WARNING',
    title: 'Mất kết nối với thiết bị',
    body: `Không nhận được tín hiệu từ thiết bị trong hơn ${formatAgeVi(timeoutS)}. Thiết bị có thể hết pin, mất sóng hoặc đã tắt.`,
    data: { kind: 'DEVICE', event: 'OFFLINE' },
    collapseKey: 'device-state',
  };
}

export function deviceBackOnlineMessage(): NotifyMessage {
  return {
    level: 'INFO',
    title: 'Thiết bị đã kết nối lại',
    body: 'Đã nhận lại tín hiệu từ thiết bị.',
    data: { kind: 'DEVICE', event: 'ONLINE' },
    collapseKey: 'device-state',
  };
}

export function deviceRebootedMessage(): NotifyMessage {
  return {
    level: 'WARNING',
    title: 'Thiết bị vừa khởi động lại',
    body: 'Thiết bị tự khởi động lại (không do lệnh từ ứng dụng). Nếu lặp lại nhiều lần, hãy kiểm tra pin và nguồn.',
    data: { kind: 'DEVICE', event: 'REBOOTED' },
    collapseKey: 'device-state',
  };
}

export function smsFailedMessage(phone: string, incidentId: string | null): NotifyMessage {
  return {
    level: 'WARNING',
    title: 'Gửi SMS cảnh báo thất bại',
    body: `Thiết bị không gửi được SMS tới ${maskPhone(phone)}.`,
    data: { kind: 'SMS_FAILED', ...(incidentId ? { incidentId } : {}) },
    collapseKey: `sms-failed-${incidentId ?? 'none'}`,
  };
}

export function contactsRejectedMessage(): NotifyMessage {
  return {
    level: 'WARNING',
    title: 'Thiết bị từ chối danh sách số khẩn cấp',
    body: 'Thiết bị không nhận được danh sách số điện thoại mới. Hãy kiểm tra định dạng số rồi lưu lại.',
    data: { kind: 'CONTACTS', event: 'REJECTED' },
    collapseKey: 'contacts-sync',
  };
}

export function healthMessage(issue: HealthIssue): NotifyMessage {
  switch (issue) {
    case 'IMU_FAULT':
      return {
        level: 'WARNING',
        title: 'Cảm biến té ngã gặp lỗi',
        body: 'Thiết bị báo cảm biến hoặc mô hình phát hiện ngã không hoạt động. Có thể không phát hiện được té ngã cho tới khi khắc phục.',
        data: { kind: 'HEALTH', issue },
        collapseKey: `health-${issue}`,
      };
    case 'NO_CONTACTS':
      return {
        level: 'WARNING',
        title: 'Thiết bị chưa có số khẩn cấp',
        body: 'Sẽ không gửi được SMS khi có té ngã. Hãy thêm số điện thoại trong mục Liên hệ.',
        data: { kind: 'HEALTH', issue },
        collapseKey: `health-${issue}`,
      };
    case 'WEAK_SIGNAL':
      return {
        level: 'WARNING',
        title: 'Sóng di động yếu',
        body: 'Thiết bị có thể không gửi được SMS hoặc dữ liệu. Hãy kiểm tra khu vực người đeo.',
        data: { kind: 'HEALTH', issue },
        collapseKey: `health-${issue}`,
      };
  }
}
