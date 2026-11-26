/**
 * Luật cảnh báo sức khỏe từ heartbeat (thuần, kiểm thử được).
 * Một cảnh báo chỉ phát khi điều kiện đúng liên tiếp đủ số lần, rồi chỉ nhắc lại sau `cooldownMs`
 * nếu vẫn còn; khi điều kiện hết thì đặt lại để lần sau cảnh báo được ngay.
 */
import { HeartbeatPayload } from '../mqtt/payloads';
import { HealthIssue } from '../notifications/messages';

export interface HealthRulesOptions {
  weakCsq: number;
  weakReadings: number;
  cooldownMs: number;
  imuReadings: number;
  contactsReadings: number;
}

export const DEFAULT_HEALTH_RULES: HealthRulesOptions = {
  weakCsq: 5,
  weakReadings: 3,
  cooldownMs: 6 * 3_600_000,
  imuReadings: 2,
  contactsReadings: 4,
};

interface IssueState {
  streak: number;
  active: boolean;
  lastAlertAt: number;
}

export class HealthTracker {
  private readonly state = new Map<HealthIssue, IssueState>();

  constructor(private readonly opts: HealthRulesOptions = DEFAULT_HEALTH_RULES) {}

  /** Trả về danh sách vấn đề cần cảnh báo ngay lúc này. */
  evaluate(hb: HeartbeatPayload, nowMs: number): HealthIssue[] {
    const out: HealthIssue[] = [];

    if (hb.imuOk !== undefined) {
      if (this.step('IMU_FAULT', hb.imuOk === false, this.opts.imuReadings, nowMs)) out.push('IMU_FAULT');
    }
    if (hb.signal !== undefined) {
      const weak = hb.signal === 99 || hb.signal <= this.opts.weakCsq;
      if (this.step('WEAK_SIGNAL', weak, this.opts.weakReadings, nowMs)) out.push('WEAK_SIGNAL');
    }
    if (hb.contacts !== undefined) {
      if (this.step('NO_CONTACTS', hb.contacts === 0, this.opts.contactsReadings, nowMs)) out.push('NO_CONTACTS');
    }
    return out;
  }

  private step(issue: HealthIssue, bad: boolean, needed: number, nowMs: number): boolean {
    const s = this.state.get(issue) ?? { streak: 0, active: false, lastAlertAt: 0 };
    this.state.set(issue, s);

    if (!bad) {
      s.streak = 0;
      s.active = false;
      return false;
    }
    s.streak++;
    if (s.streak < needed) return false;
    if (!s.active || nowMs - s.lastAlertAt >= this.opts.cooldownMs) {
      s.active = true;
      s.lastAlertAt = nowMs;
      return true;
    }
    return false;
  }
}
