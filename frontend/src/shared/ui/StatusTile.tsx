import type { ReactNode } from 'react'
import { BadgePercent, Building2, Factory, FileText, Landmark, Layers, Package, RefreshCw, TrendingUp, Truck, Wallet } from 'lucide-react'
import type { ApplicationStatus } from '@/api/types'
import { cn } from '@/shared/lib/cn'
import { statusMeta } from '@/shared/lib/statusMeta'
import styles from './StatusTile.module.css'

const productIcons: Record<string, ReactNode> = {
  OVERDRAFT: <Wallet size={20} />,
  WORKING_CAPITAL: <Package size={20} />,
  CREDIT_LINE: <Layers size={20} />,
  EQUIPMENT: <Factory size={20} />,
  LEASING: <Truck size={20} />,
  INVESTMENT: <TrendingUp size={20} />,
  COMMERCIAL_MORTGAGE: <Building2 size={20} />,
  GOV_CONTRACT: <Landmark size={20} />,
  SUBSIDIZED: <BadgePercent size={20} />,
  REFINANCING: <RefreshCw size={20} />,
}

export function StatusTile({ status, productCode }: { status: ApplicationStatus; productCode: string }) {
  return (
    <span className={cn(styles.tile, styles[statusMeta[status].tone])} aria-hidden>
      {productIcons[productCode] ?? <FileText size={20} />}
    </span>
  )
}
