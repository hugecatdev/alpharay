import { CheckCircle2, CircleAlert, OctagonAlert } from 'lucide-react'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui'
import { checkLevelMeta, type CheckFix, type PrecheckResult } from './metrics'
import styles from './PreCheck.module.css'

export function PreCheck({ result, onFix }: { result: PrecheckResult; onFix: (fix: CheckFix) => void }) {
  const meta = checkLevelMeta[result.level]
  return (
    <section className={styles.card} data-assist="precheck">
      <header className={styles.header}>
        <div className={styles.titles}>
          <h3>
            Вероятность одобрения
            <AskButton question="Как считается предварительная оценка и что на неё влияет?" />
          </h3>
          <span className={styles.caption}>Оценка по правилам кабинета — не решение банка</span>
        </div>
        <div className={styles.light} aria-hidden>
          <i className={cn(styles.dot, result.level === 'bad' && styles.onBad)} />
          <i className={cn(styles.dot, result.level === 'warn' && styles.onWarn)} />
          <i className={cn(styles.dot, result.level === 'ok' && styles.onOk)} />
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </header>
      {result.items.length === 0 ? (
        <p className={styles.ok}>
          <CheckCircle2 size={18} />
          Параметры укладываются в правила кабинета: сумма в пределах лимита, все платежи по кредитам — до 40% денежного потока.
        </p>
      ) : (
        <ul className={styles.list}>
          {result.items.map((item) => (
            <li key={item.id} className={cn(styles.item, item.level === 'bad' ? styles.itemBad : styles.itemWarn)}>
              <span className={styles.icon}>{item.level === 'bad' ? <OctagonAlert size={18} /> : <CircleAlert size={18} />}</span>
              <span className={styles.text}>
                <strong>{item.text}</strong>
                <span>{item.hint}</span>
              </span>
              {item.fix && (
                <button type="button" className={styles.fix} onClick={() => item.fix && onFix(item.fix)}>
                  {item.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
