import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Inbox, UserCheck } from 'lucide-react'
import type { ApplicationStatus, BankApplicationShort } from '@/api'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { formatDateTime, formatRelative, formatTerm } from '@/shared/lib/dates'
import { gradeTone } from '@/shared/lib/labels'
import { formatMoney } from '@/shared/lib/money'
import { statusMeta } from '@/shared/lib/statusMeta'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatusBadge, Table, Tabs } from '@/shared/ui'
import { isAssignedToMe, useAssign, useBankQueue, type AssignedFilter, type QueueStatusFilter } from './useBank'
import styles from './QueuePage.module.css'

const STATUS_OPTIONS = Object.keys(statusMeta) as ApplicationStatus[]

function AssignCell({ item }: { item: BankApplicationShort }) {
  const user = useCurrentUser()
  const assign = useAssign()
  if (item.assigned_to) {
    const mine = isAssignedToMe(item.assigned_to, user)
    return (
      <span className={mine ? styles.mine : styles.assignee}>
        {mine && <UserCheck size={14} />}
        {mine ? 'Вы' : item.assigned_to}
      </span>
    )
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={assign.isPending}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        assign.mutate(item.id)
      }}
    >
      Взять в работу
    </Button>
  )
}

function QueueRow({ item, showStatus }: { item: BankApplicationShort; showStatus: boolean }) {
  const navigate = useNavigate()
  const open = () => navigate(`/bank/applications/${item.id}`)
  return (
    <tr
      className={styles.row}
      tabIndex={0}
      onClick={open}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') open()
      }}
    >
      <td className={styles.number}>{item.number}</td>
      <td>
        <div className={styles.company}>
          <strong>{item.company_name}</strong>
          <span>ИНН {item.inn}</span>
        </div>
      </td>
      <td className={styles.product}>{item.product_name}</td>
      <td className="tabular">
        <div className={styles.amount}>
          <strong>{formatMoney(item.amount)}</strong>
          <span>{formatTerm(item.term)}</span>
        </div>
      </td>
      {showStatus && (
        <td>
          <StatusBadge status={item.status} />
        </td>
      )}
      <td>
        {item.grade ? (
          <span className={styles.grade}>
            <Badge tone={gradeTone[item.grade]}>{item.grade}</Badge>
            {item.score !== null && <span className="tabular">{item.score}</span>}
          </span>
        ) : (
          <span className={styles.dash}>—</span>
        )}
      </td>
      <td title={formatDateTime(item.waiting_since)} className={styles.waiting}>
        {formatRelative(item.waiting_since)}
      </td>
      <td>
        <AssignCell item={item} />
      </td>
    </tr>
  )
}

function SummaryChips() {
  const all = useBankQueue('MANUAL_REVIEW', 'any')
  const mine = useBankQueue('MANUAL_REVIEW', 'me')
  return (
    <div className={styles.chips}>
      <span className={styles.chip}>
        На ручном рассмотрении <b>{all.data?.length ?? '…'}</b>
      </span>
      <span className={styles.chip}>
        В работе у меня <b>{mine.data?.length ?? '…'}</b>
      </span>
      <span className={styles.chip}>
        Не назначено <b>{all.data ? all.data.filter((item) => !item.assigned_to).length : '…'}</b>
      </span>
    </div>
  )
}

export function QueuePage() {
  const [status, setStatus] = useState<QueueStatusFilter>('MANUAL_REVIEW')
  const [assigned, setAssigned] = useState<AssignedFilter>('any')
  const [oldestFirst, setOldestFirst] = useState(true)
  const queue = useBankQueue(status, assigned)

  const rows = useMemo(() => {
    const list = [...(queue.data ?? [])]
    list.sort((a, b) => {
      const diff = new Date(a.waiting_since).getTime() - new Date(b.waiting_since).getTime()
      return oldestFirst ? diff : -diff
    })
    return list
  }, [queue.data, oldestFirst])

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Кредитный конвейер"
        title="Очередь заявок"
        description="Заявки, которые конвейер передал на ручное рассмотрение. Список обновляется автоматически."
      />
      <SummaryChips />
      <div className={styles.filters}>
        <div className={styles.statusFilter}>
          <label htmlFor="queue-status" className={styles.filterLabel}>
            Статус
          </label>
          <Select id="queue-status" value={status} onChange={(event) => setStatus(event.target.value as QueueStatusFilter)}>
            <option value="ALL">Все статусы</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {statusMeta[option].title}
              </option>
            ))}
          </Select>
        </div>
        <Tabs
          value={assigned}
          onChange={setAssigned}
          items={[
            { value: 'any', label: 'Все' },
            { value: 'me', label: 'Мои' },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          className={styles.sort}
          icon={oldestFirst ? <ArrowUpNarrowWide size={16} /> : <ArrowDownWideNarrow size={16} />}
          onClick={() => setOldestFirst(!oldestFirst)}
        >
          {oldestFirst ? 'Сначала дольше ждущие' : 'Сначала новые'}
        </Button>
      </div>

      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : queue.isLoading ? (
        <div className={styles.skeletons}>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} height={54} radius={10} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.emptyWrap}>
          <EmptyState icon={<Inbox size={22} />} title="Очередь пуста">
            {status === 'MANUAL_REVIEW'
              ? 'Сейчас нет заявок на ручном рассмотрении. Новые появятся здесь автоматически.'
              : 'По выбранным фильтрам заявок нет.'}
          </EmptyState>
        </div>
      ) : (
        <Table elevated>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Компания</th>
              <th>Продукт</th>
              <th>Сумма</th>
              {status === 'ALL' && <th>Статус</th>}
              <th>Грейд</th>
              <th>
                <button type="button" className={styles.sortHead} onClick={() => setOldestFirst(!oldestFirst)}>
                  В очереди с {oldestFirst ? '↑' : '↓'}
                </button>
              </th>
              <th>Назначено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <QueueRow key={item.id} item={item} showStatus={status === 'ALL'} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
