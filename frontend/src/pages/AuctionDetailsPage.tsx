import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Clock3, Gavel, MapPin, RefreshCw } from 'lucide-react'
import { FallbackImage } from '../components/FallbackImage'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../hooks/authContext'
import { getErrorMessage } from '../services/api'
import { notify } from '../services/toast'
import { getAuction, getAuctionBids, placeAuctionBid, subscribeToAuction } from '../services/auctions'
import type { Auction, AuctionBid } from '../types'

function currency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

function countdown(target: string, now: number): string {
  const remaining = Math.max(0, new Date(target).getTime() - now)
  const days = Math.floor(remaining / 86_400_000)
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1_000)
  return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function AuctionDetailsPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [auction, setAuction] = useState<Auction | null>(null)
  const [bids, setBids] = useState<AuctionBid[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bidError, setBidError] = useState('')
  const [amount, setAmount] = useState('')
  const [placingBid, setPlacingBid] = useState(false)
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveError, setLiveError] = useState('')
  const [now, setNow] = useState(0)
  const connectedAuctionId = auction?.id

  const refreshBids = useCallback(async () => {
    const result = await getAuctionBids(id)
    setBids(result.bids)
  }, [id])

  const refreshAuction = useCallback(async () => {
    const [auctionResult] = await Promise.all([getAuction(id), refreshBids()])
    setAuction(auctionResult)
    setError('')
  }, [id, refreshBids])

  useEffect(() => {
    let active = true
    Promise.all([getAuction(id), getAuctionBids(id)])
      .then(([auctionResult, bidResult]) => {
        if (active) {
          setAuction(auctionResult)
          setBids(bidResult.bids)
          setError('')
        }
      })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'Auction could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    let interval: number | undefined
    const initialTimer = window.setTimeout(() => {
      setNow(Date.now())
      interval = window.setInterval(() => setNow(Date.now()), 1_000)
    }, 0)
    return () => {
      window.clearTimeout(initialTimer)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!connectedAuctionId || !user) return
    return subscribeToAuction(id, {
      onBid: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? { ...current, currentBid: payload.currentBid, status: 'ACTIVE' } : current)
        setLiveError('')
        void refreshBids().catch(() => setLiveError('A live bid arrived, but bid history could not be refreshed.'))
      },
      onStatus: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: payload.status,
          startTime: payload.startTime,
          endTime: payload.endTime,
          currentBid: payload.currentBid,
        } : current)
      },
      onScheduleUpdated: (payload) => {
        if (payload.auctionId === id) notify('Auction schedule updated.')
      },
      onCancelled: (payload) => {
        if (payload.auctionId === id) notify('This auction has been cancelled.')
      },
      onEndedEarly: (payload) => {
        if (payload.auctionId === id) notify('This auction has ended early.')
      },
      onAwaitingSellerApproval: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: 'COMPLETED',
          outcomeStatus: 'PENDING_SELLER_APPROVAL',
          winningBid: payload.winningBidAmount === null ? null : { amount: payload.winningBidAmount },
          endTime: payload.endTime,
        } : current)
        notify('Auction ended. The highest bid is provisional pending seller approval.')
      },
      onNoBids: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: 'COMPLETED',
          outcomeStatus: 'NO_BIDS',
          winningBid: null,
          endTime: payload.endTime,
        } : current)
        notify('Auction ended with no bids.')
      },
      onWinnerApproved: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: 'COMPLETED',
          outcomeStatus: 'ACCEPTED',
          winningBid: payload.winningBidAmount === null ? null : { amount: payload.winningBidAmount },
          endTime: payload.endTime,
        } : current)
        notify('The seller accepted the highest bid.')
      },
      onWinnerRejected: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: 'COMPLETED',
          outcomeStatus: 'REJECTED',
          winningBid: payload.winningBidAmount === null ? null : { amount: payload.winningBidAmount },
          endTime: payload.endTime,
        } : current)
        notify('The seller rejected the highest bid. The property was not sold through this auction.')
      },
      onWinnerConfirmed: (payload) => {
        if (payload.auctionId !== id) return
        setAuction((current) => current ? {
          ...current,
          status: 'COMPLETED',
          outcomeStatus: 'ACCEPTED',
          isWinningBidder: true,
          winningBid: payload.winningBidAmount === null ? null : { amount: payload.winningBidAmount },
          endTime: payload.endTime,
        } : current)
        notify('You are the confirmed winning bidder. Payment and property transfer are not included.')
      },
      onError: setLiveError,
      onConnection: (connected) => {
        setLiveConnected(connected)
        if (connected) setLiveError('')
      },
    })
  }, [connectedAuctionId, id, refreshBids, user])

  async function submitBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auction || placingBid) return
    setBidError('')
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setBidError('Enter a valid positive bid amount.')
      return
    }

    setPlacingBid(true)
    try {
      const response = await placeAuctionBid(auction.id, parsedAmount)
      setAuction((current) => current ? { ...current, currentBid: response.currentBid, status: 'ACTIVE' } : current)
      setAmount('')
      await refreshBids()
    } catch (requestError: unknown) {
      setBidError(getErrorMessage(requestError, 'Your bid could not be placed.'))
    } finally {
      setPlacingBid(false)
    }
  }

  if (loading || (!error && auction?.id !== id)) return <main className="page-wrap"><div className="container"><Spinner label="Loading auction" /></div></main>
  if (error || !auction) return <main className="page-wrap"><div className="container"><div className="error-box" role="alert">{error || 'Auction not found.'}</div><Link className="btn btn-outline" style={{ marginTop: 18 }} to="/auctions">Back to auctions</Link></div></main>

  const currentAmount = auction.winningBid?.amount ?? auction.currentBid ?? auction.startPrice
  const isUpcoming = auction.status === 'UPCOMING'
  const isOpen = auction.status === 'ACTIVE'
  const canBid = user?.role === 'BUYER' && isOpen
  const timerTarget = isUpcoming ? auction.startTime : auction.endTime
  const bidMinimum = auction.currentBid === null ? auction.startPrice : auction.currentBid + 0.01
  const statusLabel = auction.status === 'ACTIVE'
    ? 'Live now'
    : auction.status === 'COMPLETED'
      ? 'Ended'
      : auction.status === 'CANCELLED'
        ? 'Cancelled'
        : 'Upcoming'
  const timerLabel = isUpcoming
    ? 'Starts in'
    : isOpen
      ? 'Time remaining'
      : auction.status === 'CANCELLED'
        ? 'Auction cancelled'
        : 'Auction ended'
  const outcomeNotice = auction.outcomeStatus === 'PENDING_SELLER_APPROVAL'
    ? 'The highest bid is provisional while awaiting seller approval. No winner has been confirmed.'
    : auction.outcomeStatus === 'ACCEPTED'
      ? auction.isWinningBidder
        ? 'You are the confirmed winning bidder. Payment and property transfer are not included.'
        : 'The seller accepted the highest bid. Payment and property transfer are not included.'
      : auction.outcomeStatus === 'REJECTED'
        ? 'The seller rejected the highest bid. The property was not sold through this auction.'
        : auction.outcomeStatus === 'NO_BIDS'
          ? 'The auction ended without any bids.'
          : ''
  const bidLabel = auction.outcomeStatus === 'PENDING_SELLER_APPROVAL'
    ? 'Provisional highest bid'
    : auction.currentBid === null
      ? 'Starting price · no bids yet'
      : 'Highest bid'

  return (
    <main className="page-wrap">
      <div className="container">
        <Link to="/auctions" className="subtle" style={{ display: 'inline-block', marginBottom: 20 }}>← All auctions</Link>
        <div className="auction-detail-grid">
          <div>
            <div className="auction-detail-photo"><FallbackImage src={auction.property.images[0] ?? ''} alt={auction.property.title} /></div>
            <section className="panel auction-history">
              <div className="auction-section-heading"><h2>Bid history</h2><span className="subtle">{bids.length} recent bids</span></div>
              {bids.length === 0 ? <div className="empty-state"><Gavel size={24} /><h3>No bids yet</h3><p>Be the first to place a bid.</p></div> : (
                <ol className="auction-bids">
                  {bids.map((bid) => <li key={bid.id}><span>{new Date(bid.createdAt).toLocaleString()}</span><strong>{currency(bid.amount)}</strong></li>)}
                </ol>
              )}
            </section>
          </div>
          <aside className="detail-panel auction-live-panel">
            <div className="auction-detail-status">
              <span className={`auction-status auction-status-${auction.status.toLowerCase()}`}>{statusLabel}</span>
              {user && <span className={liveConnected ? 'live-indicator is-live' : 'live-indicator'}>{liveConnected ? 'Live updates on' : 'Connecting to live updates'}</span>}
            </div>
            <h1>{auction.property.title}</h1>
            <p className="property-location"><MapPin size={15} />{auction.property.location}, {auction.property.city}, {auction.property.state}</p>
            <div className="auction-current-bid"><span>{bidLabel}</span><strong>{currency(currentAmount)}</strong></div>
            <div className="auction-timer"><Clock3 size={17} /><span>{timerLabel}</span><strong>{auction.status === 'COMPLETED' || auction.status === 'CANCELLED' ? 'Closed' : now ? countdown(timerTarget, now) : '...'}</strong></div>
            {outcomeNotice && <div className="user-notice" role="status">{outcomeNotice}</div>}
            {!user && <div className="user-notice">Sign in as a buyer to receive live updates and place a bid. <Link to="/login">Sign in</Link></div>}
            {user?.role === 'BUYER' && !isOpen && <div className="user-notice">{isUpcoming ? 'Bidding opens at the scheduled start time.' : 'This auction is not accepting bids.'}</div>}
            {user?.role === 'SELLER' && <div className="user-notice">Seller accounts can view auctions but cannot place bids.</div>}
            {liveError && <div className="error-box" role="status">{liveError}</div>}
            {canBid && (
              <form className="auction-bid-form" onSubmit={(event) => void submitBid(event)}>
                <div className="field"><label htmlFor="bid-amount">Your bid (INR)</label><input id="bid-amount" type="number" min={bidMinimum} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
                <p className="label-note">Your bid must be at least {currency(bidMinimum)}. The server verifies the latest highest bid when you submit.</p>
                {bidError && <div className="error-box" role="alert">{bidError}</div>}
                <button className="btn btn-primary" type="submit" disabled={placingBid}>{placingBid ? 'Submitting bid…' : 'Place bid'}</button>
              </form>
            )}
            <button className="btn btn-quiet auction-refresh" type="button" onClick={() => void refreshAuction().catch((requestError: unknown) => setError(getErrorMessage(requestError, 'Auction could not be refreshed.')))}><RefreshCw size={15} />Refresh auction</button>
          </aside>
        </div>
      </div>
    </main>
  )
}
