/** Chạy các tác vụ bất đồng bộ lần lượt, theo đúng thứ tự gọi (tránh đua dữ liệu giữa các bản tin MQTT). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
