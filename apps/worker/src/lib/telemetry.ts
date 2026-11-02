export interface TelemetryLogEvent {
  id: string;
  timestamp: string;
  kind: 'chat' | 'agent' | 'title' | 'memory' | 'studio-image' | 'studio-video' | 'api' | string;
  path?: string;
  modelRequested?: string;
  modelResolved: string;
  providerResolved: string;
  status: 'success' | 'failover' | 'error';
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  failoverReason?: string;
  error?: string;
  clientIp?: string;
}

class TelemetryLogger {
  private events: TelemetryLogEvent[] = [];
  private readonly maxCapacity = 200;

  record(event: Omit<TelemetryLogEvent, 'id' | 'timestamp'>) {
    const entry: TelemetryLogEvent = {
      ...event,
      id: `tel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    this.events.unshift(entry);
    if (this.events.length > this.maxCapacity) {
      this.events.length = this.maxCapacity;
    }
  }

  getRecentLogs(limit = 100): TelemetryLogEvent[] {
    return this.events.slice(0, Math.min(limit, this.maxCapacity));
  }

  clear() {
    this.events = [];
  }
}

export const telemetry = new TelemetryLogger();
