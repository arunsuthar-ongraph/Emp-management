import { useEffect, useRef, useState } from 'react';
import { Empty, Typography } from 'antd';
import dayjs from 'dayjs';
import { usePalette } from '../theme';

/**
 * Candle chart of a month's attendance, one candle per day.
 *  - Wick (thin line): first check-in → last check-out
 *  - Bodies (thick bars): each check-in session; gaps between them are breaks
 *  - Below each date: total hours worked (or the day's status)
 * Time of day runs top (morning) → bottom (evening), like a calendar.
 */

type Session = { clockIn: string; clockOut: string | null; minutes: number };
type Day = { date: string; type: string; note?: string; workMinutes?: number; sessions?: Session[] };



const STATUS_LABEL: Record<string, string> = {
  WEEKEND: 'Off', HOLIDAY: 'Hol', LEAVE: 'Leave', UNPAID_LEAVE: 'LOP', ABSENT: 'Abs', NOT_MARKED: '—', NOT_EMPLOYED: '',
};
const STATUS_TEXT: Record<string, string> = {
  PRESENT: 'Present', HALF_DAY: 'Half day', WEEKEND: 'Weekend', HOLIDAY: 'Holiday', LEAVE: 'On leave', UNPAID_LEAVE: 'Unpaid leave',
  ABSENT: 'Absent', NOT_MARKED: 'Not checked in yet', NOT_EMPLOYED: 'Not employed',
};

/** Minutes after local midnight of the day the session belongs to (night shifts can exceed 24h). */
const minuteOfDay = (iso: string, day: string) => dayjs(iso).diff(dayjs(day).startOf('day'), 'minute');
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
const clock = (m: number) => dayjs().startOf('day').add(m, 'minute').format('h A');
const t = (day: string, m: number) => dayjs(day).startOf('day').add(m, 'minute').format('h:mm A');

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function HoursCandleChart({ days, fullDayMinutes = 360 }: { days: Day[]; fullDayMinutes?: number }) {
  const [ref, containerW] = useWidth();
  const p = usePalette();
  // Validated pair per mode (dataviz palette check): brand teal = full day, amber = short day
  const C = { full: p.chartFull, half: p.chartShort, wick: p.inkMuted, grid: p.chartGrid, axis: p.chartAxis, text: p.ink, muted: p.inkMuted, hover: p.raised, surface: p.surface, border: p.border };
  const [hover, setHover] = useState<number | null>(null);
  const now = dayjs();

  // Spans per day (open session runs until now)
  const rows = days.map((d) => {
    const segs = (d.sessions || []).map((s) => {
      const start = minuteOfDay(s.clockIn, d.date);
      const end = s.clockOut ? minuteOfDay(s.clockOut, d.date) : minuteOfDay(now.toISOString(), d.date);
      return { start, end: Math.max(end, start + 1), open: !s.clockOut, minutes: s.clockOut ? s.minutes : end - start };
    });
    const worked = segs.reduce((a, s) => a + s.minutes, 0);
    const first = segs.length ? Math.min(...segs.map((s) => s.start)) : null;
    const last = segs.length ? Math.max(...segs.map((s) => s.end)) : null;
    const breaks = first !== null && last !== null ? Math.max(0, last - first - worked) : 0;
    return { ...d, segs, worked, first, last, breaks };
  });

  const withData = rows.filter((r) => r.segs.length);
  if (!withData.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No check-ins this month yet" />;

  // Y range: whole hours around the earliest check-in and latest check-out
  const yMin = Math.max(0, Math.floor(Math.min(...withData.map((r) => r.first!)) / 60) * 60 - 60);
  const yMax = Math.ceil(Math.max(...withData.map((r) => r.last!)) / 60) * 60 + 60;

  const pad = { top: 12, right: 12, bottom: 44, left: 48 };
  const colW = Math.max(26, (containerW - pad.left - pad.right) / rows.length);
  const width = pad.left + pad.right + colW * rows.length;
  const height = 320;
  const plotH = height - pad.top - pad.bottom;
  const y = (m: number) => pad.top + ((m - yMin) / (yMax - yMin)) * plotH;
  const x = (i: number) => pad.left + colW * i + colW / 2;
  const bodyW = Math.min(14, colW * 0.5);

  const ticks: number[] = [];
  const step = yMax - yMin > 12 * 60 ? 180 : 120;
  for (let m = Math.ceil(yMin / step) * step; m <= yMax; m += step) ticks.push(m);

  const h = hover !== null ? rows[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover) + 14, 0), width - 250) : 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.axis, marginBottom: 8 }}>
        <span><svg width="10" height="12"><rect width="10" height="12" rx="3" fill={C.full} /></svg> Session, full day (≥ {fullDayMinutes / 60}h)</span>
        <span><svg width="10" height="12"><rect width="10" height="12" rx="3" fill={C.half} /></svg> Session, short day</span>
        <span><svg width="10" height="12"><line x1="5" y1="0" x2="5" y2="12" stroke={C.wick} strokeWidth="2" /></svg> Break (first in → last out)</span>
        <span>Number under each date = hours worked</span>
      </div>
      <div ref={ref} style={{ position: 'relative', overflowX: 'auto' }}>
        <svg width={width} height={height} role="img" aria-label="Hours worked per day" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
          {/* grid + time axis */}
          {ticks.map((m) => (
            <g key={m}>
              <line x1={pad.left} x2={width - pad.right} y1={y(m)} y2={y(m)} stroke={C.grid} />
              <text x={pad.left - 8} y={y(m)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill={C.axis}>{clock(m)}</text>
            </g>
          ))}

          {rows.map((r, i) => {
            const isToday = dayjs(r.date).isSame(now, 'day');
            const short = r.segs.length > 0 && !r.segs.some((s) => s.open) && r.worked < fullDayMinutes;
            const fill = short ? C.half : C.full;
            const label = r.segs.length ? (r.worked / 60).toFixed(1) : STATUS_LABEL[r.type] ?? '';
            return (
              <g key={r.date}>
                {hover === i && <rect x={pad.left + colW * i} y={pad.top} width={colW} height={plotH} fill={C.hover} />}
                {r.first !== null && (
                  <line x1={x(i)} x2={x(i)} y1={y(r.first)} y2={y(r.last!)} stroke={C.wick} strokeWidth="2" strokeLinecap="round" />
                )}
                {r.segs.map((s, k) => (
                  <rect
                    key={k}
                    x={x(i) - bodyW / 2}
                    y={y(s.start)}
                    width={bodyW}
                    height={Math.max(3, y(s.end) - y(s.start))}
                    rx="4"
                    fill={fill}
                    fillOpacity={s.open ? 0.55 : 1}
                    stroke={C.surface}
                    strokeWidth="2"
                    strokeDasharray={s.open ? '3 2' : undefined}
                  />
                ))}
                {/* x-axis: day number + hours worked / status */}
                <text x={x(i)} y={height - pad.bottom + 16} textAnchor="middle" fontSize="11" fill={isToday ? C.text : C.axis} fontWeight={isToday ? 700 : 400}>
                  {dayjs(r.date).format('D')}
                </text>
                <text x={x(i)} y={height - pad.bottom + 31} textAnchor="middle" fontSize="10" fill={r.segs.length ? C.text : C.muted} fontWeight={r.segs.length ? 600 : 400}>
                  {label}
                </text>
                {/* hover target: the whole column */}
                <rect x={pad.left + colW * i} y={pad.top} width={colW} height={height - pad.top} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>

        {h && (
          <div
            style={{
              position: 'absolute', top: 8, left: tipLeft, width: 240, pointerEvents: 'none',
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '8px 10px', fontSize: 12, color: C.text,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{dayjs(h.date).format('ddd, DD MMM')}</div>
            <div style={{ color: C.axis, marginBottom: 6 }}>{STATUS_TEXT[h.type] || h.type}{h.note ? ` · ${h.note}` : ''}</div>
            {h.segs.length ? (
              <>
                <Row k="Worked" v={hm(h.worked)} bold />
                <Row k="In → out" v={`${t(h.date, h.first!)} → ${h.segs.some((s) => s.open) ? 'now' : t(h.date, h.last!)}`} />
                <Row k="Breaks" v={hm(h.breaks)} />
                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6 }}>
                  {h.segs.map((s, k) => (
                    <Row key={k} k={`#${k + 1}`} v={`${t(h.date, s.start)} – ${s.open ? 'now' : t(h.date, s.end)} · ${hm(s.minutes)}`} />
                  ))}
                </div>
              </>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>No check-ins</Typography.Text>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--ink-3)' }}>{k}</span>
      <span style={{ fontWeight: bold ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}
