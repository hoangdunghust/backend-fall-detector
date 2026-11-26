/**
 * Prisma giả trong bộ nhớ, chỉ hỗ trợ các truy vấn mà các service dùng.
 * Đủ để kiểm thử logic nghiệp vụ mà không cần PostgreSQL.
 */
type Row = Record<string, any>;

const toNum = (v: any): number => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN);
const eq = (a: any, b: any): boolean => (a instanceof Date || b instanceof Date ? toNum(a) === toNum(b) : a === b);
const cmp = (a: any, b: any): number => {
  if (a instanceof Date || b instanceof Date || typeof a === 'number') return toNum(a) - toNum(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

function matches(row: Row, where: Row | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (cond === undefined) continue;
    const v = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, arg] of Object.entries(cond as Row)) {
        if (arg === undefined) continue;
        const c = cmp(v, arg);
        if (op === 'gte' && !(c >= 0)) return false;
        if (op === 'gt' && !(c > 0)) return false;
        if (op === 'lte' && !(c <= 0)) return false;
        if (op === 'lt' && !(c < 0)) return false;
        if (op === 'not' && eq(v, arg)) return false;
        if (op === 'in' && !(arg as any[]).includes(v)) return false;
      }
    } else if (!eq(v, cond)) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v; // Prisma bỏ qua undefined
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly defaults: () => Row,
    private readonly uniques: string[] = [],
    private readonly store: Fake,
    private readonly idKey = 'id',
  ) {}

  private clone(r: Row): Row { return { ...r }; }

  private withInclude(r: Row, include?: Row): Row {
    const out = this.clone(r);
    if (include?.sms) {
      out.sms = this.store.smsDelivery.rows
        .filter((s) => s.incidentId === r.id)
        .sort((a, b) => cmp(a.at, b.at))
        .map((s) => this.clone(s));
    }
    return out;
  }

  private sorted(rows: Row[], orderBy: any): Row[] {
    const spec: Array<[string, 'asc' | 'desc']> = [];
    for (const o of Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) {
      for (const [k, d] of Object.entries(o)) spec.push([k, d as 'asc' | 'desc']);
    }
    return [...rows].sort((a, b) => {
      for (const [k, d] of spec) {
        const c = cmp(a[k], b[k]);
        if (c !== 0) return d === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  async create({ data, include }: Row): Promise<Row> {
    for (const u of this.uniques) {
      if (data[u] != null && this.rows.some((r) => r[u] === data[u])) {
        throw Object.assign(new Error(`Unique constraint failed on ${u}`), { code: 'P2002' });
      }
    }
    const row: Row = { ...this.defaults() };
    if (this.idKey === 'id' && row.id === undefined) row.id = `c${String(++this.seq).padStart(6, '0')}`;
    applyData(row, data);
    this.rows.push(row);
    return this.withInclude(row, include);
  }

  async createMany({ data }: Row): Promise<{ count: number }> {
    for (const d of data) await this.create({ data: d });
    return { count: data.length };
  }

  async findFirst({ where, orderBy, include }: Row = {}): Promise<Row | null> {
    const r = this.sorted(this.rows.filter((x) => matches(x, where)), orderBy)[0];
    return r ? this.withInclude(r, include) : null;
  }

  async findUnique({ where, include }: Row): Promise<Row | null> {
    const r = this.rows.find((x) => matches(x, where));
    return r ? this.withInclude(r, include) : null;
  }

  async findMany({ where, orderBy, take, cursor, skip, include }: Row = {}): Promise<Row[]> {
    let list = this.sorted(this.rows.filter((x) => matches(x, where)), orderBy);
    if (cursor) {
      const i = list.findIndex((x) => x.id === cursor.id);
      list = i < 0 ? [] : list.slice(i + (skip ?? 0));
    }
    if (take !== undefined) list = list.slice(0, take);
    return list.map((r) => this.withInclude(r, include));
  }

  async count({ where }: Row = {}): Promise<number> {
    return this.rows.filter((x) => matches(x, where)).length;
  }

  async update({ where, data, include }: Row): Promise<Row> {
    const r = this.rows.find((x) => matches(x, where));
    if (!r) throw new Error(`${this.name}: không tìm thấy bản ghi để update`);
    applyData(r, data);
    return this.withInclude(r, include);
  }

  async updateMany({ where, data }: Row): Promise<{ count: number }> {
    const hit = this.rows.filter((x) => matches(x, where));
    hit.forEach((r) => applyData(r, data));
    return { count: hit.length };
  }

  async deleteMany({ where }: Row = {}): Promise<{ count: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((x) => !matches(x, where));
    return { count: before - this.rows.length };
  }

  async upsert({ where, update, create }: Row): Promise<Row> {
    const r = this.rows.find((x) => matches(x, where));
    if (r) {
      applyData(r, update);
      return this.clone(r);
    }
    return this.create({ data: create });
  }
}

export class Fake {
  incident: Table;
  smsDelivery: Table;
  deviceState: Table;
  deviceHealthLog: Table;
  emergencyContact: Table;
  location: Table;
  commandLog: Table;
  pushToken: Table;

  constructor() {
    const now = () => new Date();
    this.incident = new Table('incident', () => ({ status: 'OPEN', gpsValid: false, receivedAt: now(), eventId: null, confidence: null, lat: null, lon: null, gpsAgeS: null, deviceTime: null, cancelledAt: null, ackedAt: null, resolvedAt: null }), ['eventId'], this);
    this.smsDelivery = new Table('smsDelivery', () => ({ at: now(), incidentId: null, deviceTime: null }), [], this);
    this.deviceState = new Table('deviceState', () => ({ id: 1, online: false, firmware: null, lastSeenAt: null, bootedAt: null, uptimeS: null, signal: null, imuOk: null, gpsFix: null, contactsCnt: null, heap: null }), [], this);
    this.deviceHealthLog = new Table('deviceHealthLog', () => ({ at: now() }), [], this);
    this.emergencyContact = new Table('emergencyContact', () => ({ name: null, position: 0, sync: 'PENDING' }), ['phone'], this);
    this.location = new Table('location', () => ({ at: now(), ageS: null }), [], this);
    this.commandLog = new Table('commandLog', () => ({ status: 'PENDING', createdAt: now(), resolvedAt: null }), [], this);
    this.pushToken = new Table('pushToken', () => ({ createdAt: now() }), ['token'], this, 'token');
  }

  /** Các thao tác trong mảng đã được thực thi đúng thứ tự lúc gọi, nên chỉ cần chờ chúng. */
  async $transaction(ops: Array<Promise<unknown>>): Promise<unknown[]> {
    return Promise.all(ops);
  }
}

// ---------------------------------------------------------------- các đối tượng giả khác
export class FakeEmitter {
  events: Array<{ name: string; payload: any }> = [];
  emit(name: string, payload: any): boolean {
    this.events.push({ name, payload });
    return true;
  }
  of(name: string): any[] {
    return this.events.filter((e) => e.name === name).map((e) => e.payload);
  }
}

export class FakeNotifications {
  sent: any[] = [];
  async notify(msg: any): Promise<void> {
    this.sent.push(msg);
  }
}

export class FakeMqtt {
  published: Array<{ topic: string; payload: any; opts: any }> = [];
  connected = true;
  failPublish = false;
  isConnected(): boolean {
    return this.connected;
  }
  async publish(topic: string, payload: any, opts: any): Promise<void> {
    if (!this.connected || this.failPublish) throw new Error('MQTT down');
    this.published.push({ topic, payload, opts });
  }
}

export const ID = 'esp_a1b2c3d4e5f6';
export const fakeConfig = (): any => ({
  deviceId: ID,
  dedupeWindowS: 8,
  watchdog: { heartbeatTimeoutS: 90, weakSignalCsq: 5, weakSignalReadings: 3, alertCooldownMin: 360 },
  retention: { healthDays: 30, locationDays: 90 },
});

export const msg = <T>(payload: T, receivedAt: Date = new Date(), retained = false) => ({ receivedAt, retained, payload });
