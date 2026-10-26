import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antTheme, ThemeConfig } from 'antd';

/**
 * Light / dark / system theme. The choice is stored per browser; "system" follows the OS.
 * Each mode has its own selected values (not an automatic inversion), shared by Ant Design,
 * the CSS variables in styles.css and the charts.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

export const PALETTE = {
  light: {
    canvas: '#F5F7F8',
    surface: '#FFFFFF',
    raised: '#F9FAFB',
    border: '#E3E7EB',
    borderStrong: '#CDD3DA',
    ink: '#1B2430',
    inkSecondary: '#5A6575',
    inkMuted: '#8A94A3',
    brand: '#00826B',
    brandSoft: '#E6F3F0',
    onBrand: '#FFFFFF',
    // charts (validated with the dataviz palette checker against the surface)
    chartFull: '#00826B',
    chartShort: '#EDA100',
    chartGrid: '#EDF0F3',
    chartAxis: '#6B7685',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  },
  dark: {
    canvas: '#0E1316',
    surface: '#151B20',
    raised: '#1B2329',
    border: '#26303A',
    borderStrong: '#34404C',
    ink: '#E5EAEE',
    inkSecondary: '#A3ADB8',
    inkMuted: '#76818E',
    brand: '#22A38C',
    brandSoft: '#16302B',
    onBrand: '#06231E',
    chartFull: '#22A38C',
    chartShort: '#C98500',
    chartGrid: '#222B33',
    chartAxis: '#8C97A4',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
  },
};

const FONT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function antConfig(mode: Resolved): ThemeConfig {
  const p = PALETTE[mode];
  return {
    algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.brand,
      colorInfo: p.brand,
      colorLink: p.brand,
      colorTextLightSolid: p.onBrand,
      colorBgLayout: p.canvas,
      colorBgContainer: p.surface,
      colorBgElevated: mode === 'dark' ? p.raised : p.surface,
      colorBorder: p.borderStrong,
      colorBorderSecondary: p.border,
      colorText: p.ink,
      colorTextSecondary: p.inkSecondary,
      colorTextTertiary: p.inkMuted,
      fontFamily: FONT,
      fontSize: 14,
      borderRadius: 6,
      borderRadiusLG: 10,
      controlHeight: 34,
      boxShadow: 'none',
      boxShadowSecondary: mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(27,36,48,.10)',
      wireframe: false,
    },
    components: {
      Layout: { bodyBg: p.canvas, headerBg: p.surface, siderBg: p.surface, headerHeight: 60, headerPadding: '0 24px' },
      Menu: {
        itemBg: p.surface,
        itemSelectedBg: p.brandSoft,
        itemSelectedColor: p.brand,
        itemColor: p.inkSecondary,
        itemHoverBg: p.raised,
        itemBorderRadius: 6,
        itemHeight: 38,
        groupTitleColor: p.inkMuted,
        groupTitleFontSize: 12,
        activeBarBorderWidth: 0,
      },
      Card: { headerFontSize: 15, paddingLG: 20 },
      Table: { headerBg: p.raised, headerColor: p.inkSecondary, rowHoverBg: p.raised, cellPaddingBlock: 12 },
      Tabs: { horizontalMargin: '0 0 16px 0' },
      Statistic: { contentFontSize: 26 },
    },
  };
}

const Ctx = createContext<{ mode: ThemeMode; resolved: Resolved; setMode: (m: ThemeMode) => void }>(null!);
export const useThemeMode = () => useContext(Ctx);
/** Colors for charts and custom drawing in the current mode. */
export const usePalette = () => PALETTE[useThemeMode().resolved];

const KEY = 'theme-mode';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const readMode = (): ThemeMode => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const resolved: Resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* private mode: keep in memory only */
    }
  };

  const config = useMemo(() => antConfig(resolved), [resolved]);
  return (
    <Ctx.Provider value={{ mode, resolved, setMode }}>
      <ConfigProvider theme={config}>{children}</ConfigProvider>
    </Ctx.Provider>
  );
}
