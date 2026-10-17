export type Labels = Readonly<Record<string, string>>;

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface CounterMetric {
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly series: Map<string, number>;
}

interface HistogramSeries {
  count: number;
  sum: number;
  bucketCounts: number[];
}

interface HistogramMetric {
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly buckets: readonly number[];
  readonly series: Map<string, HistogramSeries>;
}

interface GaugeMetric {
  readonly help: string;
  value: number;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, CounterMetric>();
  private readonly histograms = new Map<string, HistogramMetric>();
  private readonly gauges = new Map<string, GaugeMetric>();

  registerCounter(name: string, help: string, labelNames: readonly string[] = []): void {
    this.counters.set(name, { help, labelNames, series: new Map() });
  }

  registerHistogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ): void {
    this.histograms.set(name, { help, labelNames, buckets, series: new Map() });
  }

  registerGauge(name: string, help: string): void {
    this.gauges.set(name, { help, value: 0 });
  }

  inc(name: string, labels: Labels = {}, amount = 1): void {
    const metric = this.counters.get(name);
    if (!metric) {
      return;
    }
    const key = labelKey(metric.labelNames, labels);
    metric.series.set(key, (metric.series.get(key) ?? 0) + amount);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const metric = this.histograms.get(name);
    if (!metric) {
      return;
    }
    const key = labelKey(metric.labelNames, labels);
    let series = metric.series.get(key);
    if (!series) {
      series = { count: 0, sum: 0, bucketCounts: metric.buckets.map(() => 0) };
      metric.series.set(key, series);
    }
    const target = series;
    target.count += 1;
    target.sum += value;
    metric.buckets.forEach((bound, index) => {
      if (value <= bound) {
        target.bucketCounts[index] = (target.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  setGauge(name: string, value: number): void {
    const metric = this.gauges.get(name);
    if (metric) {
      metric.value = value;
    }
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, metric] of [...this.counters].sort()) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} counter`);
      for (const [key, value] of metric.series) {
        lines.push(`${name}${key} ${value}`);
      }
    }
    for (const [name, metric] of [...this.histograms].sort()) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} histogram`);
      for (const [key, series] of metric.series) {
        metric.buckets.forEach((bound, index) => {
          lines.push(`${name}_bucket${withBucket(key, bound)} ${series.bucketCounts[index]}`);
        });
        lines.push(`${name}_bucket${withBucket(key, '+Inf')} ${series.count}`);
        lines.push(`${name}_sum${key} ${series.sum}`);
        lines.push(`${name}_count${key} ${series.count}`);
      }
    }
    for (const [name, metric] of [...this.gauges].sort()) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} gauge`);
      lines.push(`${name} ${metric.value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function labelKey(labelNames: readonly string[], labels: Labels): string {
  if (labelNames.length === 0) {
    return '';
  }
  const parts = labelNames.map((name) => `${name}="${escapeLabel(labels[name] ?? '')}"`);
  return `{${parts.join(',')}}`;
}

function withBucket(key: string, bound: number | string): string {
  const bucket = `le="${bound}"`;
  if (key === '') {
    return `{${bucket}}`;
  }
  return `${key.slice(0, -1)},${bucket}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
