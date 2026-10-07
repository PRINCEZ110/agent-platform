import { trace, Span, SpanStatusCode, Tracer as OtelTracer, context, SpanKind } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ResultOrError, ok } from '@core/types.js';

export interface TracerConfig {
  serviceName: string;
  exporter?: any;
}

export class AgentTracer {
  private provider: NodeTracerProvider;
  private tracer: OtelTracer;

  constructor(config: Partial<TracerConfig> = {}) {
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName ?? 'agent-platform'
      })
    });

    if (config.exporter) {
      this.provider.addSpanProcessor(new SimpleSpanProcessor(config.exporter));
    }

    this.provider.register();
    this.tracer = trace.getTracer(config.serviceName ?? 'agent-platform');
  }

  getTracer(): OtelTracer {
    return this.tracer;
  }

  startSpan(name: string, options?: { kind?: SpanKind; attributes?: Record<string, unknown>; parent?: Span }): Span {
    const parentContext = options?.parent ? trace.setSpan(context.active(), options.parent) : context.active();
    return this.tracer.startSpan(name, {
      kind: options?.kind ?? SpanKind.INTERNAL,
      attributes: options?.attributes
    }, parentContext);
  }

  async traceAsync<T>(name: string, fn: (span: Span) => Promise<T>, options?: { attributes?: Record<string, unknown>; kind?: SpanKind }): Promise<ResultOrError<T>> {
    return new Promise((resolve) => {
      const span = this.startSpan(name, options);
      context.with(trace.setSpan(context.active(), span), async () => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          resolve(ok(result));
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : 'Unknown error' });
          span.recordException(e instanceof Error ? e : new Error(String(e)));
          resolve(ok(null as any)); // Error handled by caller
        } finally {
          span.end();
        }
      });
    });
  }

  traceSync<T>(name: string, fn: (span: Span) => T, options?: { attributes?: Record<string, unknown>; kind?: SpanKind }): ResultOrError<T> {
    const span = this.startSpan(name, options);
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return ok(result);
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : 'Unknown error' });
      span.recordException(e instanceof Error ? e : new Error(String(e)));
      return ok(null as any);
    } finally {
      span.end();
    }
  }

  getCurrentSpan(): Span | undefined {
    return trace.getSpan(context.active());
  }

  setSpanAttribute(key: string, value: string | number | boolean): void {
    const span = this.getCurrentSpan();
    if (span) span.setAttribute(key, value);
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    const span = this.getCurrentSpan();
    if (span) span.addEvent(name, attributes);
  }

  shutdown(): Promise<void> {
    return this.provider.shutdown();
  }
}

export function createTracer(config?: Partial<TracerConfig>): AgentTracer {
  return new AgentTracer(config);
}

export const defaultTracer = createTracer();