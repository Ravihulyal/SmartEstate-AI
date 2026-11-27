import { useEffect } from 'react'
import { notify } from '../services/toast'
import { subscribeToPaymentEvents, type PaymentSocketEvent } from '../services/payments'

const eventMessages: Record<PaymentSocketEvent, string> = {
  'payment:request-created': 'A simulated payment request is ready.',
  'payment:initiated': 'A simulated payment attempt was started.',
  'payment:succeeded': 'A simulated payment was recorded as successful.',
  'payment:failed': 'A simulated payment attempt failed.',
  'payment:expired': 'A simulated payment request expired.',
  'sale-closing:pending': 'A demo sale closing is awaiting seller confirmation.',
  'sale-closing:completed': 'A demo sale closing was completed.',
  'admin:payment-updated': 'Payment monitoring data was updated.',
}

export function usePaymentNotifications(onUpdate: () => void | Promise<void>): void {
  useEffect(() => {
    let connectionWarningShown = false
    return subscribeToPaymentEvents(
      (event) => {
        notify(eventMessages[event])
        void onUpdate()
      },
      () => {
        if (connectionWarningShown) return
        connectionWarningShown = true
        notify('Live payment updates are unavailable. Use Refresh to check the latest status.', 'error')
      },
    )
  }, [onUpdate])
}
