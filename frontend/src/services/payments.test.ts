import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToPaymentEvents } from './payments'

const socketMocks = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {}
  return {
    disconnect: vi.fn(),
    handlers,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler
    }),
  }
})

vi.mock('./socket', () => ({
  createAuthenticatedSocket: () => ({
    on: socketMocks.on,
    disconnect: socketMocks.disconnect,
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(socketMocks.handlers)) delete socketMocks.handlers[key]
})

describe('payment socket subscriptions', () => {
  it('subscribes only to workflow and admin monitor events and removes the socket on cleanup', () => {
    const onEvent = vi.fn()
    const cleanup = subscribeToPaymentEvents(onEvent)
    const payload = { paymentId: 'payment-1', paymentMode: 'SIMULATED' as const, isRealPayment: false as const }

    socketMocks.handlers['payment:succeeded'](payload)
    socketMocks.handlers['admin:payment-updated'](payload)
    cleanup()

    expect(onEvent).toHaveBeenNthCalledWith(1, 'payment:succeeded', payload)
    expect(onEvent).toHaveBeenNthCalledWith(2, 'admin:payment-updated', payload)
    expect(socketMocks.on).toHaveBeenCalledWith('sale-closing:completed', expect.any(Function))
    expect(socketMocks.disconnect).toHaveBeenCalledOnce()
    expect(socketMocks.on).not.toHaveBeenCalledWith('auction:join', expect.any(Function))
  })
})
