import type { ReactNode } from 'react'
import { Factory, FileText, Package, Wallet } from 'lucide-react'
import type { ApplicationStatus } from '@/api/types'
import { cn } from '@/shared/lib/cn'
import { statusMeta } from '@/shared/lib/statusMeta'
import styles from './StatusTile.module.css'

const productIcons: Record<string, ReactNode> = {
  OVERDRAFT: <Wallet size={20} />,
  WORKING_CAPITAL: <Package size={20} />,
  EQUIPMENT: <Factory size={20} />,
}

export function StatusTile({ status, productCode }: { status: ApplicationStatus; productCode: string }) {
  return (
    <span className={cn(styles.tile, styles[statusMeta[status].tone])} aria-hidden>
      {productIcons[productCode] ?? <FileText size={20} />}
    </span>
  )
}
