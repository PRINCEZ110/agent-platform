import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { ResultOrError, ok } from '@core/types.js';

export interface MetricsConfig {
  prefix: string;
  defaultMetrics: boolean;
}

export class AgentMetrics {
  private registry: Registry;
  private prefix: string;
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  constructor(config: Partial<MetricsConfig> = {}) {
    this.prefix = config.prefix ?? 'agent_';
    this.registry = new Registry();

    if (config.defaultMetrics !== false) {
      collectDefaultMetrics({ register: this.registry, prefix: this.prefix });
    }
  }

  getRegistry(): Registry {
    return this.registry;
  }

  counter(name: string, help: string, labels: string[] = []): Counter {
    const key = `${this.prefix}${name}`;
    if (this.counters.has(key)) return this.counters.get(key)!;

    const counter = new Counter({ name: key, help, labelNames: labels, registers: [this.registry] });
    this.counters.set(key, counter);
    return counter;
  }

  gauge(name: string, help: string, labels: string[] = []): Gauge {
    const key = `${this.prefix}${name}`;
    if (this.gauges.has(key)) return this.gauges.get(key)!;

    const gauge = new Gauge({ name: key, help, labelNames: labels, registers: [this.registry] });
    this.gauges.set(key, gauge);
    return gauge;
  }

  histogram(name: string, help: string, labels: string[] = [], buckets?: number[]): Histogram {
    const key = `${this.prefix}${name}`;
    if (this.histograms.has(key)) return this.histograms.get(key)!;

    const histogram = new Histogram({ name: key, help, labelNames: labels, buckets, registers: [this.registry] });
    this.histograms.set(key, histogram);
    return histogram;
  }

  incCounter(name: string, labels: Record<string, string> = {}): void {
    this.counter(name, '').inc(labels);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauge(name, '').set(labels, value);
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this.histogram(name, '').observe(labels, value);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  async getContentType(): Promise<string> {
    return this.registry.contentType;
  }

  // Predefined metrics
  private _toolCalls?: Counter;
  private _toolDuration?: Histogram;
  private _modelCalls?: Counter;
  private _modelTokens?: Counter;
  private _modelDuration?: Histogram;
  private _taskDuration?: Histogram;
  private _errors?: Counter;
  private _activeAgents?: Gauge;

  get toolCalls(): Counter {
    if (!this._toolCalls) {
      this._toolCalls = this.counter('tool_calls_total', 'Total tool calls', ['tool', 'agent', 'outcome']);
    }
    return this._toolCalls;
  }

  get toolDuration(): Histogram {
    if (!this._toolDuration) {
      this._toolDuration = this.histogram('tool_duration_seconds', 'Tool execution duration', ['tool', 'agent'], [0.1, 0.5, 1, 2, 5, 10, 30, 60]);
    }
    return this._toolDuration;
  }

  get modelCalls(): Counter {
    if (!this._modelCalls) {
      this._modelCalls = this.counter('model_calls_total', 'Total model calls', ['provider', 'model', 'agent', 'outcome']);
    }
    return this._modelCalls;
  }

  get modelTokens(): Counter {
    if (!this._modelTokens) {
      this._modelTokens = this.counter('model_tokens_total', 'Total model tokens', ['provider', 'model', 'agent', 'type']);
    }
    return this._modelTokens;
  }

  get modelDuration(): Histogram {
    if (!this._modelDuration) {
      this._modelDuration = this.histogram('model_duration_seconds', 'Model call duration', ['provider', 'model', 'agent'], [0.5, 1, 2, 5, 10, 30, 60, 120]);
    }
    return this._modelDuration;
  }

  get taskDuration(): Histogram {
    if (!this._taskDuration) {
      this._taskDuration = this.histogram('task_duration_seconds', 'Task execution duration', ['agent', 'task_type', 'outcome'], [1, 5, 10, 30, 60, 300, 600, 1800, 3600]);
    }
    return this._taskDuration;
  }

  get errors(): Counter {
    if (!this._errors) {
      this._errors = this.counter('errors_total', 'Total errors', ['agent', 'type', 'component']);
    }
    return this._errors;
  }

  get activeAgents(): Gauge {
    if (!this._activeAgents) {
      this._activeAgents = this.gauge('active_agents', 'Number of active agents', ['agent']);
    }
    return this._activeAgents;
  }
}

export function createMetrics(config?: Partial<MetricsConfig>): AgentMetrics {
  return new AgentMetrics(config);
}

export const defaultMetrics = createMetrics();