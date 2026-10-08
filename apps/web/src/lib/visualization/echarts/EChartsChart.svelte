<script lang="ts">
  import type { EChartsType } from 'echarts/core';

  import type { ChartData, ChartKind } from '../chart-data.ts';
  import { toEChartsOption } from './chart-option.ts';
  import { echarts } from './echarts.ts';

  let {
    kind,
    data,
    selected,
    onselect,
    label,
  }: {
    kind: ChartKind;
    data: ChartData;
    selected?: string | undefined;
    /** Called with the category's value — never its formatted label. */
    onselect?: ((category: string) => void) | undefined;
    /** What the chart shows, for screen readers. */
    label?: string | undefined;
  } = $props();

  let element: HTMLDivElement;
  let chart = $state.raw<EChartsType | undefined>();

  // One ECharts instance per mounted chart: created here, resized with its box, disposed on unmount.
  $effect(() => {
    const instance = echarts.init(element);
    instance.on('click', (event) => {
      const category = data.categories[event.dataIndex];
      if (category !== null && category !== undefined) {
        onselect?.(category);
      }
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    chart = instance;
    return () => {
      observer.disconnect();
      instance.dispose();
      chart = undefined;
    };
  });

  $effect(() => {
    chart?.setOption(toEChartsOption(kind, data, selected), { notMerge: true });
  });
</script>

<div bind:this={element} class="h-full min-h-40 w-full" role="img" aria-label={label}></div>
