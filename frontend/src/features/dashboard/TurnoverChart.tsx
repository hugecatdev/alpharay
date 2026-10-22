import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { TurnoverMonth } from '@/api'
import { formatMonthLong, formatMonthShort } from '@/shared/lib/dates'
import { formatMoney, formatMoneyShort } from '@/shared/lib/money'
import { useElementWidth } from './useElementWidth'
import styles from './TurnoverChart.module.css'

const HEIGHT = 230
const PAD = { top: 16, right: 12, bottom: 30, left: 62 }

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const first = points[0]
  if (!first) return ''
  let d = `M${first.x},${first.y}`
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (!previous || !current) continue
    const midX = (previous.x + current.x) / 2
    d += ` C${midX},${previous.y} ${midX},${current.y} ${current.x},${current.y}`
  }
  return d
}

export function TurnoverChart({ data }: { data: TurnoverMonth[] }) {
  const gradientId = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const geometry = useMemo(() => {
    const innerWidth = Math.max(10, width - PAD.left - PAD.right)
    const innerHeight = HEIGHT - PAD.top - PAD.bottom
    const max = niceMax(Math.max(1, ...data.map((month) => Math.max(month.inflow, month.outflow))))
    const step = data.length > 1 ? innerWidth / (data.length - 1) : 0
    const x = (index: number) => PAD.left + index * step
    const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight
    const inflow = data.map((month, index) => ({ x: x(index), y: y(month.inflow) }))
    const outflow = data.map((month, index) => ({ x: x(index), y: y(month.outflow) }))
    const inflowPath = smoothPath(inflow)
    const lastPoint = inflow[inflow.length - 1]
    const firstPoint = inflow[0]
    const areaPath =
      lastPoint && firstPoint
        ? `${inflowPath} L${lastPoint.x},${PAD.top + innerHeight} L${firstPoint.x},${PAD.top + innerHeight} Z`
        : ''
    const ticks = [0, max / 2, max]
    return { innerHeight, max, step, x, y, inflow, outflow, inflowPath, outflowPath: smoothPath(outflow), areaPath, ticks }
  }, [data, width])

  if (data.length === 0) {
    return <div className={styles.empty}>Нет данных по оборотам за последний год</div>
  }

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const relative = event.clientX - rect.left - PAD.left
    const index = geometry.step > 0 ? Math.round(relative / geometry.step) : 0
    setActive(Math.min(data.length - 1, Math.max(0, index)))
  }

  const activeMonth = active !== null ? data[active] : undefined
  const activeX = active !== null ? geometry.x(active) : 0
  const tooltipLeft = Math.min(Math.max(activeX - 95, 0), Math.max(0, width - 190))

  return (
    <div className={styles.root} ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        className={styles.svg}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        role="img"
        aria-label="Поступления и списания по счёту за 12 месяцев"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              className={tick === 0 ? styles.axis : styles.grid}
            />
            <text x={PAD.left - 10} y={geometry.y(tick) + 4} className={styles.tickY} textAnchor="end">
              {tick === 0 ? '0 ₽' : formatMoneyShort(tick)}
            </text>
          </g>
        ))}

        {data.map((month, index) => (
          <text key={month.month} x={geometry.x(index)} y={HEIGHT - 8} className={styles.tickX} textAnchor="middle">
            {formatMonthShort(month.month)}
          </text>
        ))}

        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path d={geometry.outflowPath} className={styles.outflow} />
        <path d={geometry.inflowPath} className={styles.inflow} />

        {activeMonth && active !== null && (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={PAD.top}
              y2={PAD.top + geometry.innerHeight}
              className={styles.guide}
            />
            <circle cx={activeX} cy={geometry.y(activeMonth.outflow)} r={4.5} className={styles.dotOut} />
            <circle cx={activeX} cy={geometry.y(activeMonth.inflow)} r={5} className={styles.dotIn} />
          </g>
        )}
      </svg>

      {activeMonth && (
        <div className={styles.tooltip} style={{ left: tooltipLeft }}>
          <strong>{formatMonthLong(activeMonth.month)}</strong>
          <span>
            <i className={styles.keyIn} /> Поступления <b className="tabular">{formatMoney(activeMonth.inflow)}</b>
          </span>
          <span>
            <i className={styles.keyOut} /> Списания <b className="tabular">{formatMoney(activeMonth.outflow)}</b>
          </span>
          <span className={styles.free}>
            Чистый поток <b className="tabular">{formatMoney(activeMonth.inflow - activeMonth.outflow)}</b>
          </span>
        </div>
      )}

      <div className={styles.legend}>
        <span>
          <i className={styles.keyIn} /> Поступления
        </span>
        <span>
          <i className={styles.keyOut} /> Списания
        </span>
      </div>
    </div>
  )
}
