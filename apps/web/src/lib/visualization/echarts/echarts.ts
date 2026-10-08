import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// Only what the Viewer draws: half the bundle of `import * as echarts from 'echarts'` (Phase 0, P6-4).
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export { echarts };
