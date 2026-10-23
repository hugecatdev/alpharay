import type { ReactNode } from 'react'
import {
  BadgeCheck,
  CircleDollarSign,
  ClipboardList,
  FileSignature,
  Gift,
  Hourglass,
  Send,
  TimerOff,
  Sparkle,
  Tags,
} from 'lucide-react'
import type { NotificationType } from '@/api'

export type NotificationTone = 'violet' | 'blue' | 'green' | 'amber' | 'red' | 'neutral'

export const notificationMeta: Record<NotificationType, { icon: ReactNode; tone: NotificationTone }> = {
  APPLICATION_SUBMITTED: { icon: <Send size={17} />, tone: 'blue' },
  STAGE_PASSED: { icon: <Sparkle size={17} />, tone: 'violet' },
  INFO_REQUESTED: { icon: <ClipboardList size={17} />, tone: 'amber' },
  DECISION_MADE: { icon: <BadgeCheck size={17} />, tone: 'green' },
  OFFER_PENDING: { icon: <Tags size={17} />, tone: 'red' },
  OFFER_EXPIRING: { icon: <Hourglass size={17} />, tone: 'amber' },
  OFFER_EXPIRED: { icon: <TimerOff size={17} />, tone: 'neutral' },
  CONTRACT_READY: { icon: <FileSignature size={17} />, tone: 'violet' },
  DISBURSED: { icon: <CircleDollarSign size={17} />, tone: 'green' },
  PERSONAL_OFFER: { icon: <Gift size={17} />, tone: 'red' },
}
