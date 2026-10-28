import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { setAuthTokenGetter, setBaseUrl, useAddToWatchlist, useCreateAuction, useExitAuction, useGetAuction, useGetAuctionBids, useGetAuctions, useGetBiddingEngagement, useGetAuctionFairness, useGetCurrentUser, useGetDashboardSummary, useGetMetricsOverview, useGetMyBids, useGetNotifications, useGetPerformanceMetrics, useGetTransactions, useGetUsers, useGetWatchlist, useLogin, useLogout, useMarkAllNotificationsRead, useMarkNotificationRead, usePlaceBid, useRegister, useRemoveFromWatchlist } from '@workspace/api-client-react';
import type { Auction, AuctionListResult, AuctionResult, BidListResult, BidResult, GetAuctionsParams, User } from '@workspace/api-client-react';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Bell, Check, ChevronLeft, ChevronRight, Clock3, Gavel, Heart, LineChart, LogIn, LogOut, Menu, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, Trophy, Users, X } from 'lucide-react';
import { io } from 'socket.io-client';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 12_000 } } });
const tokenKey = 'auction-house-token';
const savedAuctionsKey = 'auction-house-watchlist';
const apiBaseUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const socketUrl = (import.meta.env.VITE_SOCKET_URL || apiBaseUrl || '').trim().replace(/\/+$/, '');
const resolveApiUrl = (url: string) => {
  if (!url.startsWith('/')) return url;
  if (!apiBaseUrl) return url;
  return `${apiBaseUrl}${url}`;
};
setBaseUrl(apiBaseUrl || null);
setAuthTokenGetter(() => localStorage.getItem(tokenKey));
const getSavedIds = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(savedAuctionsKey) || '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};
const persistSavedId = (id: string, saved: boolean) => {
  const ids = new Set(getSavedIds());
  if (saved) ids.add(id);
  else ids.delete(id);
  localStorage.setItem(savedAuctionsKey, JSON.stringify([...ids]));
};
const money = (v?: number) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateShort = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const dateTime = (d?: string) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const timeLeft = (end?: string | Date, now = Date.now()) => {
  if (!end) return '—';
  const ms = new Date(end).getTime() - now;
  if (ms <= 0) return 'Closed';
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  const hrs = Math.floor(ms / 3_600_000), days = Math.floor(hrs / 24);
  return days ? `${days}d ${hrs % 24}h` : hrs ? `${hrs}h ${Math.floor(ms / 60_000) % 60}m` : `${Math.max(1, Math.floor(ms / 60_000))}m`;
};
const titleCase = (s = '') => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());

async function sendAdminAction(path: string, method: 'PATCH' | 'DELETE', body?: unknown): Promise<string> {
  const token = localStorage.getItem(tokenKey);
  if (!token) throw new Error('Your admin session has expired. Sign in again.');
  const response = await fetch(resolveApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as { message?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(result.error?.message || result.message || `The request failed (${response.status}).`);
  }
  return result.message || 'Changes saved.';
}

function AuctionCountdown({ endAt, onExpire }: { endAt: string | Date; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const expiredFor = useRef<string | Date | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (Date.parse(String(endAt)) <= now && expiredFor.current !== endAt) {
      expiredFor.current = endAt;
      onExpire?.();
    }
  }, [endAt, now, onExpire]);
  return <>{timeLeft(endAt, now)}</>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell /></WouterRouter></QueryClientProvider>;
}

function Shell() {
  const [loc, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const current = useGetCurrentUser({ query: { enabled: !!token, queryKey: ['/api/auth/me'] } });
  const user = current.data?.success ? current.data.data : null;
  const notifications = useGetNotifications({ query: { enabled: !!token, queryKey: ['/api/notifications'], refetchInterval: 45_000 } });
  const logout = useLogout();
  const qc = useQueryClient();
  useEffect(() => { setMenuOpen(false); }, [loc]);
  useEffect(() => {
    const socket = io(socketUrl || undefined, { path: '/socket.io' });
    socket.on('auction:updated', (update: { auctionId?: string }) => {
      const refreshes = [
        qc.invalidateQueries({ queryKey: ['/api/auctions'] }),
        qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] }),
        qc.invalidateQueries({ queryKey: ['/api/me/bids'] }),
        qc.invalidateQueries({ queryKey: ['/api/transactions'] }),
        qc.invalidateQueries({ queryKey: ['/api/admin/metrics/overview'] }),
        qc.invalidateQueries({ queryKey: ['/api/admin/metrics/standard'] }),
        qc.invalidateQueries({ queryKey: ['/api/admin/metrics/custom'] }),
        qc.invalidateQueries({ queryKey: ['/api/admin/metrics/trends'] }),
        qc.invalidateQueries({ queryKey: ['/api/metrics/overview'] }),
      ];
      if (update.auctionId) {
        refreshes.push(
          qc.invalidateQueries({ queryKey: [`/api/auctions/${update.auctionId}`] }),
          qc.invalidateQueries({ queryKey: ['/api/auctions', update.auctionId, 'bids'] }),
        );
      }
      void Promise.all(refreshes);
    });
    return () => { socket.disconnect(); };
  }, [qc]);
  const onLogout = () => logout.mutate(undefined, { onSettled: () => {
    localStorage.removeItem(tokenKey);
    setToken(null);
    qc.clear();
    setLocation('/');
  } });
  return <div className="grain min-h-[100dvh]">
    <header className="site-header">
      <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Gavel size={17} /></span><span>LOT<span className="brand-dot">.</span>HOUSE</span></Link>
      <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
        <Link href="/auctions" className={loc.startsWith('/auctions') ? 'nav-active' : ''}>Explore</Link>
        {user && <Link href="/dashboard" className={loc === '/dashboard' ? 'nav-active' : ''}>My space</Link>}
        {user && user.role !== 'ADMIN' && <Link href="/seller/auctions/new" className={loc === '/seller/auctions/new' ? 'nav-active' : ''}>New listing</Link>}
        {user?.role === 'ADMIN' && <><Link href="/admin/metrics" className={loc === '/admin/metrics' ? 'nav-active' : ''}>Studio</Link><Link href="/admin/software-metrics" className={loc === '/admin/software-metrics' ? 'nav-active' : ''}>Software Metrics</Link><Link href="/admin/auctions" className={loc === '/admin/auctions' ? 'nav-active' : ''}>Moderation</Link></>}
      </nav>
      <div className="header-actions">
        <span className="market-live"><i /> MARKET LIVE</span>
        {user ? <><Link href="/notifications" className="icon-button notification-button" aria-label="Notifications" data-testid="link-notifications"><Bell size={18}/>{(notifications.data?.unreadCount || 0) > 0 && <b>{notifications.data?.unreadCount}</b>}</Link>
          <div className="user-chip"><span className="avatar">{user.name?.slice(0,1).toUpperCase()}</span><span className="user-name">{user.name.split(' ')[0]}</span><button className="quiet-button" onClick={onLogout} title="Sign out" data-testid="button-logout"><LogOut size={16}/></button></div>
        </> : <><Link className="text-link login-link" href="/login" data-testid="link-login">Sign in</Link><Link className="button button-dark button-small" href="/register" data-testid="link-register">Join the house <ArrowRight size={15}/></Link></>}
      </div>
      <button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" data-testid="button-menu">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
    </header>
    <Switch>
      <Route path="/" component={HomePage}/>
      <Route path="/auctions" component={AuctionsPage}/>
      <Route path="/auctions/:id" component={AuctionPage}/>
      <Route path="/login" component={() => <AuthPage mode="login" onAuthenticated={setToken}/>}/>
      <Route path="/register" component={() => <AuthPage mode="register" onAuthenticated={setToken}/>}/>
      <Route path="/dashboard" component={() => <DashboardPage user={user}/>}/>
      <Route path="/seller/auctions/new" component={() => <CreateListingPage user={user}/>}/>
      <Route path="/watchlist" component={WatchlistPage}/>
      <Route path="/notifications" component={NotificationsPage}/>
      <Route path="/transactions" component={TransactionsPage}/>
      <Route path="/admin/metrics" component={() => <MetricsPage user={user}/>}/>
      <Route path="/admin/software-metrics" component={() => <SoftwareMetricsPage user={user}/>}/>
      <Route path="/admin/users" component={() => <UsersPage user={user}/>}/>
      <Route path="/admin/auctions" component={() => <AdminAuctionsPage user={user}/>}/>
      <Route><NotFound/></Route>
    </Switch>
    <footer className="site-footer"><Link href="/" className="brand"><span className="brand-mark"><Gavel size={15}/></span><span>LOT<span className="brand-dot">.</span>HOUSE</span></Link><span>Good things find their next home.</span><span className="footer-meta">FAIR BIDS · REAL ACTIVITY · OPEN MARKET</span></footer>
  </div>;
}

function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action && <div className="title-action">{action}</div>}</div>;
}

function Status({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><i/>{titleCase(status)}</span>;
}

function AuctionCard({ auction, compact = false }: { auction: Auction; compact?: boolean }) {
  const [saved, setSaved] = useState(() => getSavedIds().includes(auction.id));
  const qc = useQueryClient();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const isLive = auction.status === 'LIVE' || auction.status === 'ENDING_SOON';
  const toggle = (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const op = saved ? remove : add;
    op.mutate({ auctionId: auction.id }, { onSuccess: () => { setSaved(!saved); persistSavedId(auction.id, !saved); } });
  };
  return <article className={`auction-card ${compact ? 'auction-card-compact' : ''}`}>
    <Link href={`/auctions/${auction.id}`} className="auction-image-link" data-testid={`link-auction-${auction.id}`}>
      <div className="auction-image">{auction.imageUrl ? <img src={auction.imageUrl} alt={auction.title} loading="lazy"/> : <div className="image-placeholder"><Gavel size={36}/><span>LOT HOUSE / OBJECT Nº {auction.id.slice(-3)}</span></div>}
        <div className="image-top"><Status status={auction.status}/><button className={`save-button ${saved ? 'is-saved' : ''}`} aria-label={saved ? 'Remove from watchlist' : 'Save to watchlist'} onClick={toggle} data-testid={`button-watch-${auction.id}`}><Heart size={17} fill={saved ? 'currentColor' : 'none'}/></button></div>
      </div>
      <div className="auction-card-body"><div className="card-category">{auction.category} <span>·</span> {auction.bidCount} bids</div><h3>{auction.title}</h3>
        <div className="card-price-row"><div><span className="price-label">{auction.status === 'COMPLETED' || auction.status === 'CANCELLED' ? 'Final price' : auction.bidCount > 0 ? 'Current bid' : 'Starting at'}</span><strong>{money(auction.bidCount > 0 || isLive ? auction.currentPrice : auction.startingPrice)}</strong></div><div className="time-tag"><Clock3 size={14}/>{auction.status === 'UPCOMING' ? `Opens ${dateShort(auction.startAt)}` : isLive ? <AuctionCountdown endAt={auction.endAt} onExpire={() => { void qc.invalidateQueries({ queryKey: ['/api/auctions'] }); }}/> : 'Closed'}</div></div>
      </div>
    </Link>
  </article>;
}

function HomePage() {
  const { data, isLoading, isError, refetch } = useGetAuctions({ status: 'ALL', sort: 'endingSoon', page: 1, pageSize: 8 });
  const auctions = data?.data || [];
  const live = auctions.filter(a => a.status === 'LIVE' || a.status === 'ENDING_SOON');
  return <main className="page-enter">
    <section className="home-hero">
      <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> THE GOOD FINDS A NEW OWNER</div><h1>Worth the wait.<br/><em>Worth the bid.</em></h1><p>A considered marketplace for objects with a past—and a future. Find your next favorite in a fair, live auction.</p><div className="hero-actions"><Link href="/auctions" className="button button-dark">Explore the lots <ArrowRight size={17}/></Link><Link href="/register" className="button button-outline">Become a seller</Link></div>
        <div className="hero-footnote"><span className="tiny-seal"><ShieldCheck size={15}/></span> Transparent bidding. Real-time activity. No guesswork.</div>
      </div>
      <div className="hero-art"><div className="hero-art-bg"></div><div className="hero-art-caption"><span>OBJECTS WITH A STORY</span><span>VOL. 01 — 2025</span></div><div className="hero-sculpture"><div className="sculpture-orbit"></div><div className="sculpture-center"><Gavel size={75} strokeWidth={1.05}/></div><span className="sculpture-number">01</span><span className="sculpture-label">THE<br/>COLLECTOR’S<br/>EDIT</span></div><div className="hero-note">A good auction<br/>is a shared story.</div></div>
    </section>
    <section className="trust-strip"><div><strong>02:14:08</strong><span>average auction window</span></div><div><strong>Every bid</strong><span>server-validated in real time</span></div><div><strong>Open metrics</strong><span>fairness, engagement, performance</span></div><div className="trust-link"><Link href="/admin/metrics">How we measure trust <ArrowUpRight size={15}/></Link></div></section>
    <section className="section-wrap featured-section"><div className="section-head"><div><div className="eyebrow">THE FLOOR IS OPEN</div><h2>Lots worth a closer look<span className="accent-dot">.</span></h2><p>Handpicked pieces, live and coming up.</p></div><Link href="/auctions" className="arrow-link">See all auctions <ArrowRight size={16}/></Link></div>
      {isLoading ? <AuctionSkeletons/> : isError ? <ErrorPanel retry={() => refetch()}/> : auctions.length ? <div className="auction-grid">{auctions.slice(0,4).map(a => <AuctionCard auction={a} key={a.id}/>)}</div> : <EmptyState icon={<ShoppingBag size={25}/>} title="The floor is quiet—for now." detail="Check back soon for new lots, or be the first to list one." action={<Link href="/seller/auctions/new" className="button button-dark">Create a listing <Plus size={16}/></Link>}/>}
    </section>
    <section className="live-band"><div className="live-band-mark"><span className="live-dot"/>LIVE NOW</div><div className="live-band-copy"><span>{live.length ? `${live.length} lots are drawing bids right now` : 'A little anticipation makes a good story'}</span><span>Follow the room as it changes.</span></div><Link href="/auctions?status=LIVE" className="button button-cream">Enter the room <ArrowRight size={16}/></Link></section>
    <section className="section-wrap editorial-section"><div className="editorial-card"><div className="editorial-index">01 / THE PRINCIPLE</div><h2>Good commerce<br/>is <em>fair commerce.</em></h2><p>Every bid is validated. Every auction has a clear clock. Every outcome is part of the record.</p><Link href="/admin/metrics" className="arrow-link">See the numbers behind the promise <ArrowRight size={16}/></Link><div className="editorial-stamp"><ShieldCheck size={25}/><span>OPEN<br/>BY DESIGN</span></div></div><div className="editorial-aside"><div className="eyebrow">A MARKETPLACE WITH ITS CARDS ON THE TABLE</div><div className="big-stat"><span>01</span><p>one transparent<br/>bid history</p></div><div className="big-stat"><span>∞</span><p>room for the right<br/>next owner</p></div><div className="big-stat"><span>100%</span><p>activity measured<br/>from the source</p></div></div></section>
    <section className="closing-cta"><div><div className="eyebrow">YOUR NEXT GREAT FIND</div><h2>There’s a place for<br/><em>your point of view.</em></h2></div><Link href="/auctions" className="button button-dark">Browse the collection <ArrowRight size={16}/></Link></section>
  </main>;
}

function AuctionSkeletons() { return <div className="auction-grid">{[0,1,2,3].map(x => <div className="skeleton-card" key={x}><div className="skeleton-image"/><div className="skeleton-line"/><div className="skeleton-line short"/></div>)}</div>; }
function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{detail}</p>{action}</div>; }
function ErrorPanel({ retry }: { retry: () => void }) { return <div className="error-panel"><strong>We couldn’t reach the auction floor.</strong><span>Give it another try in a moment.</span><button className="button button-outline" onClick={retry} data-testid="button-retry">Try again <ArrowRight size={15}/></button></div>; }

function AuctionsPage() {
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<GetAuctionsParams['sort']>('endingSoon');
  const [page, setPage] = useState(1);
  const query = useMemo<GetAuctionsParams>(() => ({ search: search || undefined, category: category || undefined, status: status as GetAuctionsParams['status'], sort, page, pageSize: 12 }), [search, category, status, sort, page]);
  const { data, isLoading, isError, refetch } = useGetAuctions(query);
  const rows = data?.data || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 12)));
  const categories = Array.from(new Set(rows.map(a => a.category))).sort();
  return <main className="page-enter content-page section-wrap">
    <PageTitle eyebrow="THE AUCTION ROOM" title="Find your next favorite." detail="A moving collection of objects, ideas, and second chances." action={<span className="results-count">{data?.total ?? '—'} <small>lots</small></span>}/>
    <div className="filter-bar"><label className="search-field"><Search size={17}/><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search objects, makers, stories…" aria-label="Search auctions" data-testid="input-search"/></label><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status" data-testid="select-status"><option value="ALL">All statuses</option><option value="LIVE">Live now</option><option value="ENDING_SOON">Ending soon</option><option value="UPCOMING">Coming up</option><option value="COMPLETED">Completed</option></select><select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} aria-label="Filter by category" data-testid="select-category"><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><select value={sort} onChange={e => setSort(e.target.value as GetAuctionsParams['sort'])} aria-label="Sort auctions" data-testid="select-sort"><option value="endingSoon">Ending soon</option><option value="newest">Newest</option><option value="mostBids">Most bids</option><option value="highestPrice">Highest bid</option><option value="lowestPrice">Lowest bid</option></select></div>
    {isLoading ? <AuctionSkeletons/> : isError ? <ErrorPanel retry={() => refetch()}/> : rows.length ? <><div className="auction-grid">{rows.map(a => <AuctionCard auction={a} key={a.id}/>)}</div><div className="pagination"><span>Showing {rows.length ? (page - 1) * (data?.pageSize || 12) + 1 : 0}–{(page - 1) * (data?.pageSize || 12) + rows.length} of {data?.total || 0}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" data-testid="button-page-previous"><ChevronLeft size={18}/></button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" data-testid="button-page-next"><ChevronRight size={18}/></button></div></div></> : <EmptyState icon={<Search size={25}/>} title="No lots match that search." detail="Try another phrase or loosen the filters." action={<button onClick={() => { setSearch(''); setCategory(''); setStatus('ALL'); }} className="button button-outline">Clear filters <X size={15}/></button>}/>}
  </main>;
}

function AuctionPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const auctionQuery = useGetAuction(id);
  const bidsQuery = useGetAuctionBids(id, { query: { queryKey: ['/api/auctions', id, 'bids'], refetchInterval: 30_000 } });
  const userQuery = useGetCurrentUser({ query: { enabled: !!localStorage.getItem(tokenKey), queryKey: ['/api/auth/me'] } });
  const auction = auctionQuery.data?.data;
  const placeBid = usePlaceBid();
  const exitAuction = useExitAuction();
  const [amount, setAmount] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(() => getSavedIds().includes(id));
  const add = useAddToWatchlist(), remove = useRemoveFromWatchlist();
  const minBid = auction ? auction.currentPrice + auction.increment : 0;
  const canBid = auction?.status === 'UPCOMING' || auction?.status === 'LIVE' || auction?.status === 'ENDING_SOON';
  useEffect(() => { if (auction) setAmount(String(minBid)); }, [auction?.id, auction?.currentPrice, auction?.increment]);
  useEffect(() => {
    if (!auction || auction.status === 'COMPLETED' || auction.status === 'CANCELLED') return;
    const nextStatusChange = auction.status === 'UPCOMING' ? auction.startAt : auction.endAt;
    const remaining = new Date(nextStatusChange).getTime() - Date.now();
    const timeout = window.setTimeout(() => { void auctionQuery.refetch(); }, Math.max(0, remaining + 50));
    return () => window.clearTimeout(timeout);
  }, [auction?.endAt, auction?.startAt, auction?.status, auctionQuery.refetch]);
  if (auctionQuery.isLoading) return <main className="section-wrap content-page"><div className="detail-skeleton"/></main>;
  if (auctionQuery.isError || !auction) return <main className="section-wrap content-page"><ErrorPanel retry={() => auctionQuery.refetch()}/></main>;
  const applySuccessfulBid = (result: BidResult) => {
    setFeedback(result.message || 'Your bid is in.');
    const knownBids = bidsQuery.data?.data;
    const isNewBidder = knownBids
      ? !knownBids.some(bid => bid.status === 'ACCEPTED' && bid.bidderId === result.data.bidderId)
      : false;
    const updateAuction = (value: Auction): Auction => ({
      ...value,
      currentPrice: result.data.amount,
      bidCount: value.bidCount + 1,
      uniqueBidders: value.uniqueBidders + Number(isNewBidder),
      status: value.status === 'UPCOMING'
        ? 'UPCOMING'
        : Date.parse(value.endAt) <= Date.now() + 60 * 60 * 1000
          ? 'ENDING_SOON'
          : 'LIVE',
      exitedBidderIds: (value.exitedBidderIds ?? []).filter(id => id !== result.data.bidderId),
    });
    qc.setQueryData<AuctionResult>([`/api/auctions/${id}`], current =>
      current ? { ...current, data: updateAuction(current.data) } : current,
    );
    qc.setQueriesData<AuctionListResult>({ queryKey: ['/api/auctions'] }, current =>
      current
        ? { ...current, data: current.data.map(item => item.id === id ? updateAuction(item) : item) }
        : current,
    );
    qc.setQueryData<BidListResult>(['/api/auctions', id, 'bids'], current =>
      current ? { ...current, data: [result.data, ...current.data] } : current,
    );
    void qc.invalidateQueries({ queryKey: ['/api/auctions'] });
  };
  const bidSubmit = (e: FormEvent) => { e.preventDefault(); setFeedback(''); placeBid.mutate({ auctionId: id, data: { amount: Number(amount) } }, { onSuccess: applySuccessfulBid, onError: err => setFeedback(err.message || 'Bid could not be placed.') }); };
  const toggleWatch = () => (saved ? remove : add).mutate({ auctionId: id }, { onSuccess: () => { setSaved(!saved); persistSavedId(id, !saved); } });
  const bids = bidsQuery.data?.data || [];
  const exitedBidderIds = new Set(auction.exitedBidderIds ?? []);
  const activeBids = bids
    .filter(bid => bid.status === 'ACCEPTED' && !exitedBidderIds.has(bid.bidderId))
    .sort((left, right) => right.amount - left.amount || new Date(left.placedAt).getTime() - new Date(right.placedAt).getTime());
  const activeParticipantCount = new Set(activeBids.map(bid => bid.bidderId)).size;
  const winningBid = auction.status === 'COMPLETED' && auction.winnerId
    ? bids
      .filter(bid => bid.status === 'ACCEPTED' && bid.bidderId === auction.winnerId)
      .sort((left, right) => right.amount - left.amount || new Date(left.placedAt).getTime() - new Date(right.placedAt).getTime())[0]
    : undefined;
  const userId = userQuery.data?.success ? userQuery.data.data.id : undefined;
  const hasParticipated = !!userId && bids.some(bid => bid.status === 'ACCEPTED' && bid.bidderId === userId);
  const hasExited = !!userId && exitedBidderIds.has(userId);
  const isLeading = !!userId && activeBids[0]?.bidderId === userId;
  const exitSubmit = () => {
    if (!window.confirm('Exit this auction? You can rejoin later by placing another accepted bid.')) return;
    setFeedback('');
    exitAuction.mutate({ auctionId: id }, {
      onSuccess: async result => {
        setFeedback(result.message || 'You exited this auction.');
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['/api/auctions'] }),
          qc.invalidateQueries({ queryKey: [`/api/auctions/${id}`] }),
          qc.invalidateQueries({ queryKey: ['/api/auctions', id, 'bids'] }),
        ]);
      },
      onError: err => setFeedback(err.message || 'Could not exit this auction.'),
    });
  };
  return <main className="page-enter section-wrap content-page"><div className="breadcrumb"><Link href="/auctions">Auctions</Link><ChevronRight size={14}/><span>{auction.category}</span></div><div className="auction-detail">
    <div className="detail-visual"><div className="detail-image">{auction.imageUrl ? <img src={auction.imageUrl} alt={auction.title}/> : <div className="image-placeholder large"><Gavel size={55}/><span>LOT HOUSE / OBJECT Nº {id.slice(-3)}</span></div>}<div className="detail-image-tag">LOT Nº {id.slice(-5).toUpperCase()}</div></div><div className="detail-image-caption"><span>DOCUMENTED OBJECT</span><span>SELLER: {auction.sellerName}</span></div></div>
    <div className="detail-info"><div className="eyebrow">{auction.category} / LOT {id.slice(-4)}</div><div className="detail-title-line"><h1>{auction.title}</h1><Status status={auction.status}/></div><p className="detail-description">{auction.description}</p><div className="seller-line"><span className="avatar small-avatar">{auction.sellerName.slice(0,1)}</span><span>Offered by <strong>{auction.sellerName}</strong></span><span className="seller-trust"><ShieldCheck size={15}/> Verified seller</span></div>
      <div className="bid-panel"><div className="bid-panel-top"><span>{auction.status === 'COMPLETED' ? 'Sold for' : auction.bidCount > 0 ? 'Current bid' : 'Opening bid'}</span><span className="live-indicator">{auction.status === 'UPCOMING' ? 'PRE-BIDDING OPEN' : auction.status === 'LIVE' || auction.status === 'ENDING_SOON' ? <><i/> LIVE AUCTION</> : titleCase(auction.status)}</span></div><strong className="current-price">{money(auction.currentPrice)}</strong><div className="bid-panel-meta"><span>{auction.bidCount} bids · {activeParticipantCount} active / {auction.uniqueBidders} bidders</span><span><Clock3 size={14}/>{auction.status === 'UPCOMING' ? `Bidding closes ${dateTime(auction.endAt)}` : auction.status === 'COMPLETED' || auction.status === 'CANCELLED' ? 'Closed' : <><AuctionCountdown endAt={auction.endAt}/> left</>}</span></div>
        {canBid
          ? userQuery.data?.success && userQuery.data.data.role !== 'BUYER' && userQuery.data.data.role !== 'SELLER'
            ? <div className="closed-notice">Only buyer accounts can bid. Sign in with a buyer account to join the auction.</div>
            : <form onSubmit={bidSubmit} className="bid-form"><label htmlFor="bid-amount">Your bid <span>Minimum {money(minBid)}</span></label><div className="bid-input"><span>$</span><input id="bid-amount" type="number" min={minBid} step={auction.increment} value={amount} onChange={e => setAmount(e.target.value)} required data-testid="input-bid-amount"/><button className="button button-dark" disabled={placeBid.isPending || !userQuery.data?.success} data-testid="button-place-bid">{placeBid.isPending ? 'Submitting…' : 'Place bid'} <ArrowRight size={16}/></button></div>{!userQuery.data?.success && <Link href="/login" className="signin-hint">Sign in to join the bidding <ArrowRight size={13}/></Link>}{feedback && <div className={`form-feedback ${placeBid.isError || exitAuction.isError ? 'feedback-error' : ''}`}>{feedback}</div>}</form>
          : <div className="closed-notice">{auction.status === 'UPCOMING' ? 'This lot is not open for bidding yet.' : 'Bidding has closed for this lot.'}</div>}
        {canBid && userQuery.data?.success && (userQuery.data.data.role === 'BUYER' || userQuery.data.data.role === 'SELLER') && hasParticipated && (
          hasExited
            ? <div className="closed-notice">You have exited this auction. Place another accepted bid to rejoin.</div>
            : isLeading
              ? <div className="closed-notice">You are leading and cannot exit yet. You can exit if another bidder overtakes you.</div>
              : <button className="button button-outline exit-auction-button" onClick={exitSubmit} disabled={exitAuction.isPending} data-testid="button-exit-auction">{exitAuction.isPending ? 'Exiting…' : 'Exit auction'} <LogOut size={15}/></button>
        )}
        <button className={`watch-detail ${saved ? 'saved' : ''}`} onClick={toggleWatch} data-testid="button-detail-watch"><Heart size={17} fill={saved ? 'currentColor' : 'none'}/>{saved ? 'Saved to your watchlist' : 'Add to watchlist'}</button>
      </div>
      <div className="auction-facts"><div><span>Starting price</span><strong>{money(auction.startingPrice)}</strong></div><div><span>Bid increment</span><strong>{money(auction.increment)}</strong></div><div><span>Closes</span><strong>{dateTime(auction.endAt)}</strong></div></div>
      {auction.status === 'COMPLETED' && auction.winnerId && (
        <div className="auction-winner" role="status" data-testid="auction-winner">
          <div className="winner-icon"><Trophy size={20}/></div>
          <div className="winner-copy">
            <span className="winner-eyebrow">AUCTION WINNER</span>
            {winningBid
              ? <><strong>{winningBid.bidderName}</strong><span>Winning bid · {money(winningBid.amount)}</span></>
              : bidsQuery.isLoading
                ? <strong>Loading winner details…</strong>
                : bidsQuery.isError
                  ? <><strong>Winner details unavailable</strong><button className="winner-retry" onClick={() => void bidsQuery.refetch()}>Try again</button></>
                  : <strong>Winning bidder confirmed</strong>}
          </div>
          <span className="winner-badge">WON</span>
        </div>
      )}
      {auction.status === 'COMPLETED' && !auction.winnerId && (
        <div className="closed-notice winner-no-bids" role="status">Auction closed without a winning bid.</div>
      )}
      <div className="fairness-note"><ShieldCheck size={19}/><div><strong>A fair room, by design.</strong><span>Every bid is timestamped and validated. See the full activity record below.</span></div></div>
    </div></div>
    <section className="bid-history"><div className="section-head"><div><div className="eyebrow">THE ROOM, IN REAL TIME</div><h2>Bid history<span className="accent-dot">.</span></h2></div><span className="refresh-note"><span className="live-dot"/> Updates automatically</span></div>{bidsQuery.isLoading ? <div className="skeleton-line"/> : bids.length ? <div className="history-table"><div className="history-head"><span>Bidder</span><span>Placed</span><span>Bid amount</span><span>Result</span></div>{bids.map((b, i) => <div className={`history-row ${b.id === winningBid?.id ? 'history-row-winner' : ''}`} key={b.id} data-testid={`row-bid-${b.id}`}><span><span className="history-avatar">{b.bidderName.slice(0,1)}</span>{b.bidderName}{b.id === winningBid?.id ? <em>Winner</em> : auction.status !== 'COMPLETED' && i === 0 && b.status === 'ACCEPTED' && <em>Leading</em>}</span><span>{dateTime(b.placedAt)}</span><strong>{money(b.amount)}</strong>{b.id === winningBid?.id ? <span className="winner-result">WINNER</span> : <Status status={b.status}/>}</div>)}</div> : <div className="history-empty">No bids have been placed. The opening move is yours.</div>}</section>
  </main>;
}

function AuthPage({ mode, onAuthenticated }: { mode: 'login' | 'register'; onAuthenticated: (token: string) => void }) {
  const login = useLogin(), register = useRegister();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    const f = new FormData(e.currentTarget);
    if (mode === 'login') login.mutate({ data: { email: String(f.get('email')), password: String(f.get('password')) } }, { onSuccess: res => { if (!res.success) { setError(res.message); return; } localStorage.setItem(tokenKey, res.data.token); onAuthenticated(res.data.token); queryClient.invalidateQueries(); setLocation('/dashboard'); }, onError: err => setError(err.message) });
    else register.mutate({ data: { name: String(f.get('name')), email: String(f.get('email')), password: String(f.get('password')), role: String(f.get('role')) as 'BUYER' | 'SELLER' } }, { onSuccess: res => { if (!res.success) { setError(res.message); return; } localStorage.setItem(tokenKey, res.data.token); onAuthenticated(res.data.token); queryClient.invalidateQueries(); setLocation('/dashboard'); }, onError: err => setError(err.message) });
  };
  const busy = login.isPending || register.isPending;
  return <main className="auth-layout page-enter"><div className="auth-story"><Link href="/" className="brand"><span className="brand-mark"><Gavel size={16}/></span><span>LOT<span className="brand-dot">.</span>HOUSE</span></Link><div className="auth-story-copy"><div className="eyebrow">THE ROOM IS OPEN</div><h1>For the things<br/>you’ll <em>keep.</em></h1><p>Join a marketplace where every bid has a timestamp, every seller has a name, and every object has another chapter.</p></div><div className="auth-story-foot"><ShieldCheck size={18}/> Built around fair bidding and real activity.</div></div><div className="auth-form-wrap"><div className="auth-form-inner"><div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'MAKE YOURSELF AT HOME'}</div><h2>{mode === 'login' ? 'Good to see you.' : 'Start with a name.'}</h2><p>{mode === 'login' ? 'Sign in to follow the lots and join the room.' : 'Create an account to bid, save, or sell. Every account can both bid and list.'}</p><form className="stack-form" onSubmit={submit}>{mode === 'register' && <label>Your name<input name="name" minLength={2} maxLength={80} autoComplete="name" required placeholder="How should we call you?" data-testid="input-name"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" data-testid="input-email"/></label><label>Password<input name="password" type="password" minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="At least 8 characters" data-testid="input-password"/></label>{mode === 'register' && <label>Start with a…<select name="role" defaultValue="BUYER" data-testid="select-role"><option value="BUYER">Buyer profile</option><option value="SELLER">Seller profile</option></select><small>Your profile type won’t limit your marketplace actions.</small></label>}{error && <div className="form-feedback feedback-error" role="alert">{error}</div>}<button className="button button-dark full-button" disabled={busy} data-testid="button-auth-submit">{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create your account'}<ArrowRight size={16}/></button></form><div className="auth-switch">{mode === 'login' ? <>New to the house? <Link href="/register">Create an account</Link></> : <>Already have a seat? <Link href="/login">Sign in</Link></>}</div></div><div className="auth-smallprint">By continuing, you agree to keep the room fair.</div></div></main>;
}

function DashboardPage({ user }: { user: User | null }) {
  const summary = useGetDashboardSummary({ query: { enabled: !!user, queryKey: ['/api/dashboard/summary'] } });
  const canBid = user?.role === 'BUYER' || user?.role === 'SELLER';
  const myBids = useGetMyBids({ query: { enabled: !!user && canBid, queryKey: ['/api/me/bids'] } });
  const auctionQuery = useGetAuctions(
    { status: 'ALL', page: 1, pageSize: 50, sort: 'newest' },
    { query: { enabled: user?.role === 'BUYER' || user?.role === 'SELLER', queryKey: ['/api/auctions', 'seller-dashboard'] } },
  );
  const transactionQuery = useGetTransactions({ query: { enabled: user?.role === 'BUYER' || user?.role === 'SELLER', queryKey: ['/api/transactions'] } });
  if (!user) return <AuthGate title="Your own corner of the room." detail="Sign in to see bids, saved lots, and the latest activity." />;
  const s = summary.data?.data;
  const buyer = user.role === 'BUYER' || user.role === 'SELLER';
  const seller = user.role === 'BUYER' || user.role === 'SELLER';
  const admin = user.role === 'ADMIN';
  const sellerAuctions = auctionQuery.data?.data?.filter((auction) => auction.sellerId === user.id) ?? [];
  const sellerTransactions = transactionQuery.data?.data ?? [];
  const cards = buyer
    ? [['Active bids', s?.activeBidCount], ['Lots won', s?.wonCount], ['Watchlist', s?.watchlistCount], ['Total spent', money(s?.totalSpending)], ['Your listings', sellerAuctions.length], ['Seller revenue', money(s?.sellerRevenue)]]
    : admin
      ? [['Auctions', s?.totalAuctions], ['Live now', s?.liveAuctions], ['Completed', s?.completedAuctions], ['Recorded bids', s?.totalBids]]
      : [['Your lots', s?.totalAuctions], ['Live now', s?.liveAuctions], ['Completed', s?.completedAuctions], ['Seller revenue', money(s?.sellerRevenue)]];
  return <main className="section-wrap content-page page-enter">
    <PageTitle
      eyebrow={`${user.role} / OVERVIEW`}
      title={`Good to have you, ${user.name.split(' ')[0]}.`}
      detail={buyer && seller ? 'Your bids, wins, listings, and sales—all in one place.' : admin ? 'Platform activity and moderation tools in one place.' : 'Your marketplace activity in one place.'}
      action={seller
        ? <Link href="/seller/auctions/new" className="button button-dark"><Plus size={16}/> New listing</Link>
        : admin
          ? <Link href="/admin/metrics" className="button button-dark"><LineChart size={16}/> Platform studio</Link>
          : <Link href="/auctions" className="button button-dark">Find a lot <ArrowRight size={15}/></Link>}
    />
    {summary.isLoading
      ? <div className="metric-skeletons">{[0,1,2,3].map(n=><div key={n} className="skeleton-card"/>)}</div>
      : summary.isError
        ? <ErrorPanel retry={() => summary.refetch()}/>
        : <>
          <div className="stat-grid">{cards.map(([label,value])=><div className="stat-card" key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong><small>From real marketplace activity</small></div>)}</div>
          {buyer && <div className="dashboard-quick-links"><Link href="/watchlist" className="button button-outline"><Heart size={15}/> View watchlist</Link><Link href="/transactions" className="button button-outline"><ShoppingBag size={15}/> Wins and transactions</Link></div>}
          {seller && <div className="dashboard-quick-links"><Link href="/transactions" className="button button-outline"><ShoppingBag size={15}/> Completed sales and transactions</Link></div>}
          {seller && <section className="surface-panel seller-dashboard-panel">
            <div className="panel-heading"><div><div className="eyebrow">YOUR AUCTIONS</div><h2>Listings and results</h2></div><Gavel size={18}/></div>
            {auctionQuery.isLoading || transactionQuery.isLoading
              ? <div className="skeleton-line"/>
              : auctionQuery.isError || transactionQuery.isError
                ? <ErrorPanel retry={() => { void auctionQuery.refetch(); void transactionQuery.refetch(); }}/>
                : sellerAuctions.length
                  ? <div className="my-bids-list">{sellerAuctions.map((auction) => {
                    const sale = sellerTransactions.find((transaction) => transaction.auctionId === auction.id);
                    const detail = sale
                      ? `Won by ${sale.buyerName} · ${money(sale.finalPrice)}`
                      : `${auction.bidCount} bids · Current ${money(auction.currentPrice)}`;
                    return <Link href={`/auctions/${auction.id}`} className="my-bid-row" key={auction.id}>
                      <span>{auction.title}<small>{detail} · Closes {dateTime(auction.endAt)}</small></span>
                      <Status status={auction.status}/>
                      <ArrowRight size={15}/>
                    </Link>;
                  })}</div>
                  : <EmptyState icon={<Gavel size={23}/>} title="No listings yet." detail="Create a listing to start monitoring bids and sales." action={<Link href="/seller/auctions/new" className="button button-dark"><Plus size={15}/> Create a listing</Link>}/>}
          </section>}
          {admin && <div className="dashboard-quick-links"><Link href="/admin/auctions" className="button button-outline"><ShieldCheck size={15}/> Moderate auctions</Link><Link href="/admin/users" className="button button-outline"><Users size={15}/> Manage accounts</Link><Link href="/transactions" className="button button-outline"><ShoppingBag size={15}/> Review transactions</Link></div>}
          <div className="dashboard-columns">
            <section className="surface-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT SIGNAL</div><h2>Activity</h2></div><Activity size={18}/></div>{s?.recentActivity?.length ? <div className="activity-list">{s.recentActivity.map(a=><div key={a.id} className="activity-item"><span className="activity-mark"><i/></span><div><strong>{a.title}</strong><span>{a.detail}</span></div><time>{dateShort(a.createdAt)}</time></div>)}</div> : <EmptyState icon={<Activity size={23}/>} title="A clean slate." detail="Platform activity will appear here as the marketplace grows."/>}</section>
            {canBid && <section className="surface-panel"><div className="panel-heading"><div><div className="eyebrow">BID POSITION</div><h2>Your bids</h2></div><Gavel size={18}/></div>{myBids.isLoading ? <div className="skeleton-line"/> : myBids.data?.data?.length ? <div className="my-bids-list">{myBids.data.data.slice(0,5).map(item=><Link href={`/auctions/${item.auction.id}`} className="my-bid-row" key={item.bid.id}><span>{item.auction.title}<small>{money(item.bid.amount)} · {titleCase(item.bid.status)}</small></span><span className={item.leading ? 'leading-tag' : 'outbid-tag'}>{item.leading ? 'Leading' : item.auction.status === 'COMPLETED' ? item.auction.winnerId === user.id ? 'Won' : 'Closed' : 'Outbid'}</span><ArrowRight size={15}/></Link>)}</div> : <EmptyState icon={<Gavel size={23}/>} title="No bids placed yet." detail="A good find starts with a first bid." action={<Link href="/auctions" className="arrow-link">Explore auctions <ArrowRight size={15}/></Link>}/>}</section>}
          </div>
        </>}
  </main>;
}

function AuthGate({ title, detail }: { title: string; detail: string }) { return <main className="section-wrap content-page"><EmptyState icon={<LogIn size={24}/>} title={title} detail={detail} action={<Link href="/login" className="button button-dark">Sign in <ArrowRight size={15}/></Link>}/></main>; }

function CreateListingPage({ user }: { user: User | null }) {
  const create = useCreateAuction(); const qc = useQueryClient(); const [, setLocation] = useLocation(); const [error, setError] = useState(''); const [imageUrl, setImageUrl] = useState(''); const [imagePreviewError, setImagePreviewError] = useState(false);
  const imageFileInput = useRef<HTMLInputElement>(null);
  if (!user) return <AuthGate title="Ready to offer something?" detail="Sign in as a seller to create and manage your lots." />;
  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setError('Choose a PNG, JPEG, WebP, or GIF image.');
      event.currentTarget.value = '';
      return;
    }
    if (file.size > 3_500_000) {
      setError('The image must be 3.5 MB or smaller.');
      event.currentTarget.value = '';
      return;
    }
    setError('');
    setImageUrl('');
    setImagePreviewError(false);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('The image could not be read. Try another file.');
        return;
      }
      setImageUrl(reader.result);
      setImagePreviewError(false);
    };
    reader.onerror = () => setError('The image could not be read. Try another file.');
    reader.readAsDataURL(file);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (!imageUrl.trim()) {
      setError('Add an image URL or upload an image before publishing.');
      return;
    }
    if (imagePreviewError) {
      setError('The image preview could not be loaded. Check the URL or upload another image.');
      return;
    }
    const f = new FormData(e.currentTarget);
    create.mutate({ data: { title: String(f.get('title')), description: String(f.get('description')), category: String(f.get('category')), imageUrl: imageUrl.trim(), startingPrice: Number(f.get('startingPrice')), increment: Number(f.get('increment')), startAt: new Date(String(f.get('startAt'))).toISOString(), endAt: new Date(String(f.get('endAt'))).toISOString() } }, { onSuccess: res => { if (!res.success) { setError(res.message); return; } qc.invalidateQueries({ queryKey: ['/api/auctions'] }); setLocation(`/auctions/${res.data.id}`); }, onError: err => setError(err.message) });
  };
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="SELLER STUDIO / NEW LOT" title="Give it a new chapter." detail="Tell the room what makes this one worth finding."/><div className="listing-layout"><form className="listing-form surface-panel" onSubmit={submit}><div className="form-section-label"><span>01</span> The object</div><label>Listing title<input name="title" required minLength={3} maxLength={100} placeholder="A name with a little character" data-testid="input-listing-title"/></label><label>Story and condition<textarea name="description" required minLength={20} maxLength={3000} rows={5} placeholder="History, details, condition—what should its next owner know?" data-testid="input-listing-description"/></label><div className="form-two"><label>Category<input name="category" required minLength={2} maxLength={60} placeholder="Ceramics, design, books…" data-testid="input-listing-category"/></label><label>Image URL<input name="imageUrl" type="text" value={imageUrl.startsWith('data:image/') ? '' : imageUrl} onChange={event => { setImageUrl(event.target.value); setImagePreviewError(false); setError(''); }} placeholder="https://…" data-testid="input-listing-image"/></label></div><div className="listing-image-options"><label className="image-upload-button" htmlFor="listing-image-file" role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); imageFileInput.current?.click(); } }}>{imageUrl.startsWith('data:image/') ? 'Choose a different image' : 'Or upload an image'} <Plus size={15}/></label><input ref={imageFileInput} className="visually-hidden-file" id="listing-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleImageUpload} data-testid="input-listing-image-file"/><span>PNG, JPEG, WebP or GIF · max 3.5 MB</span></div><div className="image-preview" aria-live="polite">{imageUrl && !imagePreviewError ? <img src={imageUrl} alt="Preview of the auction listing image" onError={() => setImagePreviewError(true)}/> : <div className="image-preview-empty"><Gavel size={23}/><span>{imagePreviewError ? 'Image preview could not be loaded. Check the link or choose another image.' : 'Your product image preview will appear here.'}</span></div>}</div><div className="form-section-label form-section-spaced"><span>02</span> The auction</div><div className="form-two"><label>Starting price ($)<input name="startingPrice" type="number" min="0.01" step="0.01" required placeholder="120.00" data-testid="input-start-price"/></label><label>Bid increment ($)<input name="increment" type="number" min="0.01" step="0.01" required placeholder="5.00" data-testid="input-increment"/></label><label>Opens<input name="startAt" type="datetime-local" required data-testid="input-start-date"/></label><label>Closes<input name="endAt" type="datetime-local" required data-testid="input-end-date"/></label></div>{error && <div className="form-feedback feedback-error">{error}</div>}<div className="listing-submit"><span><ShieldCheck size={16}/> Bids are server-validated and timestamped.</span><button className="button button-dark" disabled={create.isPending} data-testid="button-create-auction">{create.isPending ? 'Publishing…' : 'Publish listing'} <ArrowRight size={16}/></button></div></form><aside className="listing-aside"><div className="eyebrow">A NOTE TO SELLERS</div><h3>Good details make good auctions.</h3><p>A clear title, honest condition notes, and a useful image help the right person find your lot.</p><div className="aside-rule"/><div className="aside-check"><Check size={15}/> Start and end times are shown in your local timezone.</div><div className="aside-check"><Check size={15}/> Your bids and sale are recorded in activity metrics.</div><div className="aside-check"><Check size={15}/> You can track buyer engagement from the dashboard.</div></aside></div></main>;
}

function WatchlistPage() {
  const token = localStorage.getItem(tokenKey);
  const q = useGetAuctions({ status: 'ALL', page: 1, pageSize: 50, sort: 'endingSoon' });
  const watch = useGetWatchlistWrapped(!!token);
  const rem = useRemoveFromWatchlist(); const qc = useQueryClient();
  if (!token) return <AuthGate title="Keep the good ones close." detail="Sign in to see and manage your saved lots." />;
  const ids = watch.ids;
  const selected = q.data?.data?.filter(a => ids.includes(a.id)) || [];
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="YOUR SHORTLIST" title="Watchlist." detail="The ones you’re keeping an eye on." action={<span className="results-count">{selected.length} <small>saved</small></span>}/>{watch.isLoading || q.isLoading ? <AuctionSkeletons/> : watch.isError || q.isError ? <ErrorPanel retry={() => { watch.refetch(); q.refetch(); }}/> : selected.length ? <div className="auction-grid">{selected.map(a=><div key={a.id} className="watchlist-card"><AuctionCard auction={a}/><button className="remove-watch" onClick={() => rem.mutate({ auctionId: a.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/watchlist'] }); } })} data-testid={`button-remove-watch-${a.id}`}><X size={14}/> Remove</button></div>)}</div> : <EmptyState icon={<Heart size={24}/>} title="Nothing saved just yet." detail="Tap the heart on a lot to keep it on your shortlist." action={<Link href="/auctions" className="button button-dark">Explore lots <ArrowRight size={15}/></Link>}/>}</main>;
}

function useGetWatchlistWrapped(enabled: boolean) {
  const result = useGetWatchlist({ query: { enabled, queryKey: ['/api/watchlist'] } });
  const ids = Array.isArray(result.data?.data)
    ? result.data.data.map((auction) => auction.id)
    : getSavedIds();
  return { ...result, ids };
}

function NotificationsPage() {
  const enabled = !!localStorage.getItem(tokenKey);
  const q = useGetNotifications({ query: { enabled, queryKey: ['/api/notifications'] } });
  const mark = useMarkNotificationRead(), all = useMarkAllNotificationsRead(); const qc = useQueryClient();
  if (!enabled) return <AuthGate title="Keep up with the room." detail="Sign in to see bid updates, auction alerts, and outcomes." />;
  const notify = q.data?.data || [];
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="YOUR INBOX" title="Notifications." detail="The moments that matter, without the noise." action={notify.some(n=>!n.read) ? <button className="button button-outline" onClick={() => all.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/notifications'] }) })} data-testid="button-mark-all-read"><Check size={15}/> Mark all read</button> : undefined}/>{q.isLoading ? <div className="notification-skeleton">{[1,2,3].map(n=><div className="skeleton-line" key={n}/>)}</div> : q.isError ? <ErrorPanel retry={() => q.refetch()}/> : notify.length ? <div className="notification-list">{notify.map(n=><div className={`notification-row ${n.read ? '' : 'unread'}`} key={n.id} data-testid={`notification-${n.id}`}><span className="notification-icon"><Bell size={17}/></span><div className="notification-copy"><div><strong>{n.title}</strong>{!n.read && <i/>}</div><p>{n.message}</p><span>{dateTime(n.createdAt)} · {titleCase(n.type)}</span></div>{n.auctionId && <Link href={`/auctions/${n.auctionId}`} className="notification-open">View lot <ArrowRight size={14}/></Link>}{!n.read && <button className="quiet-button" title="Mark as read" onClick={() => mark.mutate({ id: n.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/notifications'] }) })} data-testid={`button-read-${n.id}`}><Check size={17}/></button>}</div>)}</div> : <EmptyState icon={<Bell size={24}/>} title="All caught up." detail="Bid updates and important auction moments will land here."/>}</main>;
}

function TransactionsPage() {
  const enabled = !!localStorage.getItem(tokenKey);
  const q = useGetTransactions({ query: { enabled, queryKey: ['/api/transactions'] } });
  if (!enabled) return <AuthGate title="Your wins, in one place." detail="Sign in to follow payments and winning transactions." />;
  const transactions = q.data?.data || [];
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="AFTER THE HAMMER" title="Transactions." detail="Winning sales and their payment status." action={<span className="results-count">{transactions.length} <small>records</small></span>}/>{q.isLoading ? <div className="surface-panel"><div className="skeleton-line"/></div> : q.isError ? <ErrorPanel retry={() => q.refetch()}/> : transactions.length ? <div className="transaction-list">{transactions.map(t=><article className="transaction-card" key={t.id} data-testid={`transaction-${t.id}`}><div className="transaction-icon"><ShoppingBag size={19}/></div><div className="transaction-name"><strong>{t.auctionTitle}</strong><span>Buyer {t.buyerName} <i/> Seller {t.sellerName}</span><small>Created {dateTime(t.createdAt)}</small></div><div className="transaction-price"><small>FINAL PRICE</small><strong>{money(t.finalPrice)}</strong></div><div className="transaction-status"><Status status={t.status}/><span>Payment: {titleCase(t.paymentStatus)}</span></div><Link href={`/auctions/${t.auctionId}`} className="icon-button" aria-label="View auction"><ArrowUpRight size={17}/></Link></article>)}</div> : <EmptyState icon={<ShoppingBag size={24}/>} title="No transactions yet." detail="When an auction closes with a winner, the next steps will appear here." action={<Link href="/auctions" className="button button-dark">Find a lot <ArrowRight size={15}/></Link>}/>}</main>;
}

type SoftwareMetricRange = '1h' | '24h' | '7d' | '30d' | 'all';
type SoftwareMetric = {
  id: string;
  name: string;
  description: string;
  formula: string;
  value: number | null;
  unit: string;
  period: string;
  updatedAt: string;
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA';
  supportingStats?: Record<string, number | string | null>;
  components?: { key: string; name: string; value: number | null; weight: number; description: string }[];
};
type SoftwareMetricsSummary = {
  registeredUsers: number;
  auctions: number;
  bidAttempts: number;
  acceptedBids: number;
  rejectedBids: number;
  completedAuctions: number;
  demoData?: boolean;
  range: SoftwareMetricRange;
  period: string;
  updatedAt: string;
};
type SoftwareMetricTrend = {
  label: string;
  bidAttempts: number;
  acceptedBids: number;
  rejectedBids: number;
  averageResponseMs: number | null;
};

async function loadSoftwareMetrics<T>(section: string, range: SoftwareMetricRange): Promise<T> {
  const token = localStorage.getItem(tokenKey);
  if (!token) throw new Error('Your admin session has expired. Sign in again.');
  const response = await fetch(resolveApiUrl(`/api/admin/metrics/${section}?range=${range}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json() as { success?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Could not load software metrics.');
  }
  return payload.data;
}

function SoftwareMetricsPage({ user }: { user: User | null }) {
  const enabled = user?.role === 'ADMIN';
  const [range, setRange] = useState<SoftwareMetricRange>('24h');
  const overview = useQuery({
    queryKey: ['/api/admin/metrics/overview', range],
    queryFn: () => loadSoftwareMetrics<SoftwareMetricsSummary>('overview', range),
    enabled,
    refetchInterval: 5_000,
  });
  const standard = useQuery({
    queryKey: ['/api/admin/metrics/standard', range],
    queryFn: () => loadSoftwareMetrics<{ metrics: SoftwareMetric[] }>('standard', range),
    enabled,
    refetchInterval: 5_000,
  });
  const custom = useQuery({
    queryKey: ['/api/admin/metrics/custom', range],
    queryFn: () => loadSoftwareMetrics<{ metrics: SoftwareMetric[] }>('custom', range),
    enabled,
    refetchInterval: 5_000,
  });
  const trends = useQuery({
    queryKey: ['/api/admin/metrics/trends', range],
    queryFn: () => loadSoftwareMetrics<{ trends: SoftwareMetricTrend[] }>('trends', range),
    enabled,
    refetchInterval: 5_000,
  });
  if (!enabled) return <AdminGate user={user}/>;
  const hasError = overview.isError || standard.isError || custom.isError || trends.isError;
  const anyLoading = overview.isLoading || standard.isLoading || custom.isLoading || trends.isLoading;
  const standardMetrics = standard.data?.metrics ?? [];
  const customMetrics = custom.data?.metrics ?? [];
  const trendRows = trends.data?.trends ?? [];
  const updatedAt = overview.data?.updatedAt;
  const retry = () => {
    void Promise.all([overview.refetch(), standard.refetch(), custom.refetch(), trends.refetch()]);
  };
  return <main className="section-wrap content-page page-enter software-metrics-page">
    <PageTitle
      eyebrow="PLATFORM STUDIO / SOFTWARE METRICS"
      title="The system, measured."
      detail="Operational metrics calculated from persisted auctions, bids, user activity, and API request events."
      action={<label className="metrics-range-filter">Time range<select value={range} onChange={event => setRange(event.target.value as SoftwareMetricRange)} aria-label="Software metrics time range">
        <option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All Time</option>
      </select></label>}
    />
    {anyLoading ? <div className="metric-skeletons">{[1, 2, 3, 4].map(index => <div className="skeleton-card" key={index}/>)}</div> : null}
    {hasError && <div className="form-feedback feedback-error" role="alert">
      {overview.error?.message || standard.error?.message || custom.error?.message || trends.error?.message || 'Some software metrics could not be loaded.'}
      <button type="button" className="arrow-link" onClick={retry}>Retry <ArrowRight size={14}/></button>
    </div>}
    {overview.data && <div className="metrics-top-grid software-summary-grid">
      {[
        ['Registered users', overview.data.registeredUsers],
        ['Auctions in period', overview.data.auctions],
        ['Bid attempts', overview.data.bidAttempts],
        ['Accepted / rejected', `${overview.data.acceptedBids} / ${overview.data.rejectedBids}`],
      ].map(([label, value]) => <div className="metric-card surface-panel" key={label}>
        <div className="metric-card-head"><span>{label}</span></div><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
        <small>{overview.data?.period} · {overview.data?.demoData ? 'synthetic in-memory demo data' : 'persisted application data'}</small>
      </div>)}
    </div>}
    {overview.data?.demoData && <div className="metrics-empty-note" role="status">
      Demo mode is on: sample records exist only in this API process and are never saved to MongoDB. Select All Time to see metrics that include the older sample transactions.
    </div>}
    {!anyLoading && overview.data && overview.data.bidAttempts === 0 && overview.data.auctions === 0 &&
      <div className="metrics-empty-note">No auction or bid activity exists in this period yet. Metrics with missing denominators are shown as N/A.</div>}
    <section className="software-metric-section">
      <div className="panel-heading"><div><div className="eyebrow">STANDARD METRICS</div><h2>10 standard software metrics</h2></div><span className="results-count">Updated {updatedAt ? dateTime(updatedAt) : '—'}</span></div>
      {standardMetrics.length > 0 && <div className="software-metrics-grid">{standardMetrics.map(item => <SoftwareMetricCard key={item.id} metric={item}/>)}</div>}
    </section>
    <section className="software-metric-section custom-metrics-section">
      <div className="panel-heading"><div><div className="eyebrow">PROJECT-SPECIFIC INDICATORS</div><h2>Custom Auction Metrics</h2></div><span className="results-count">BES + AFS</span></div>
      {customMetrics.length > 0 && <div className="software-custom-grid">{customMetrics.map(item => <SoftwareMetricCard key={item.id} metric={item} custom/>)}</div>}
    </section>
    <section className="software-metric-section">
      <div className="panel-heading"><div><div className="eyebrow">HISTORICAL ACTIVITY</div><h2>Operational trends</h2></div><Activity size={18}/></div>
      {trendRows.length > 0 ? <div className="analytics-grid">
        <section className="surface-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">BID ATTEMPTS</div><h2>Bid volume by interval</h2></div><Gavel size={18}/></div>
          <Chart points={trendRows.map(row => ({ label: row.label, value: row.bidAttempts }))}/>
        </section>
        <section className="surface-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">API LATENCY</div><h2>Average response time (ms)</h2></div><Activity size={18}/></div>
          <Chart points={trendRows.map(row => ({ label: row.label, value: row.averageResponseMs ?? 0 }))}/>
        </section>
      </div> : <div className="chart-empty">No persisted request samples are available for this period.</div>}
    </section>
    <div className="metrics-footer">Refreshes every 5 seconds · Updated {updatedAt ? dateTime(updatedAt) : '—'} · All times are UTC in calculations.</div>
  </main>;
}

function SoftwareMetricCard({ metric, custom = false }: { metric: SoftwareMetric; custom?: boolean }) {
  const value = custom && metric.status === 'INSUFFICIENT_DATA'
    ? 'Insufficient data'
    : metric.value === null
      ? 'N/A'
      : `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${metric.unit}`;
  return <article className={`software-metric-card surface-panel ${custom ? 'software-custom-card' : ''}`}>
    <div className="software-metric-heading"><div><span className="eyebrow">{custom ? 'CUSTOM' : 'STANDARD'}</span><h3>{metric.name}</h3></div>
      <strong className={metric.value === null ? 'metric-unavailable' : ''}>{value}</strong>
    </div>
    <p>{metric.description}</p>
    <div className="software-metric-formula"><span>FORMULA</span><code>{metric.formula}</code></div>
    {metric.components && <div className="software-metric-components">{metric.components.map(component =>
      <div key={component.key}><span><strong>{component.name}</strong><small>{component.description}</small></span>
        <b>{component.value === null ? 'Insufficient data' : `${component.value.toFixed(1)} / 100`} <small>{component.weight}%</small></b>
      </div>,
    )}</div>}
    {metric.supportingStats && <div className="software-metric-support">
      {Object.entries(metric.supportingStats).map(([key, amount]) => <span key={key}>{titleCase(key)}: <strong>{amount ?? 'N/A'}{key === 'p95ResponseTimeMs' ? ' ms' : ''}</strong></span>)}
    </div>}
    <div className="software-metric-meta"><span>{metric.period}</span><span>{metric.status === 'AVAILABLE' ? 'Calculated' : 'Insufficient data'}</span><span>Updated {dateTime(metric.updatedAt)}</span></div>
  </article>;
}

function AdminGate({ user }: { user: User | null }) {
  if (!user) return <AuthGate title="Administrator sign-in required." detail="Sign in with an administrator account to manage the platform." />;
  return <main className="section-wrap content-page"><EmptyState icon={<ShieldCheck size={24}/>} title="Administrator access required." detail="This platform area is only available to administrator accounts." action={<Link href="/dashboard" className="button button-dark">Back to my space <ArrowRight size={15}/></Link>}/></main>;
}

function MetricsPage({ user }: { user: User | null }) {
  const enabled = user?.role === 'ADMIN';
  const overview = useGetMetricsOverview({ query: { enabled, queryKey: ['/api/metrics/overview'], refetchInterval: 60_000 } });
  const engagement = useGetBiddingEngagement({ query: { enabled, queryKey: ['/api/metrics/bidding-engagement'], refetchInterval: 60_000 } });
  const fairness = useGetAuctionFairness({ query: { enabled, queryKey: ['/api/metrics/auction-fairness'], refetchInterval: 60_000 } });
  const performance = useGetPerformanceMetrics({ query: { enabled, queryKey: ['/api/metrics/performance'], refetchInterval: 30_000 } });
  if (!enabled) return <AdminGate user={user}/>;
  const metricRows = overview.data?.data?.metrics || [];
  if (overview.isLoading) return <main className="section-wrap content-page"><div className="metric-skeletons">{[1,2,3,4].map(n=><div className="skeleton-card" key={n}/>)}</div></main>;
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="PLATFORM STUDIO / LIVE DATA" title="Trust, with receipts." detail="Activity computed from real marketplace events—not placeholders." action={<Link href="/admin/users" className="button button-outline"><Users size={15}/> User activity <ArrowRight size={14}/></Link>}/>
    <div className="metrics-top-grid">{metricRows.slice(0,4).map(m=><div className="metric-card" key={m.id}><div className="metric-card-head"><span>{m.label}</span><span className={m.trendPercent >= 0 ? 'trend-up' : 'trend-down'}>{m.trendPercent >= 0 ? <ArrowUpRight size={14}/> : <ArrowDown size={14}/>} {Math.abs(m.trendPercent)}%</span></div><strong>{m.value.toLocaleString()}{m.unit}</strong><div className="spark-bars">{m.history.map((p,i)=><i key={i} style={{height:`${Math.max(10,Math.min(100,p.value/(Math.max(...m.history.map(x=>x.value),1))*100))}%`}} title={`${p.label}: ${p.value}`}/>)}</div><small>{m.period} · {m.formula}</small></div>)}</div>
    <div className="scores-grid"><ScorePanel title="Bidding engagement" abbreviation="BES" result={engagement.data?.data} loading={engagement.isLoading} error={engagement.isError} retry={() => engagement.refetch()} accent="green"/><ScorePanel title="Auction fairness" abbreviation="AFS" result={fairness.data?.data} loading={fairness.isLoading} error={fairness.isError} retry={() => fairness.refetch()} accent="coral"/></div>
    <div className="analytics-grid"><section className="surface-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">BID ACTIVITY</div><h2>People in the room</h2></div><LineChart size={18}/></div><Chart points={overview.data?.data?.bidActivity || []}/></section><section className="surface-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">AUCTION ACTIVITY</div><h2>Lots over time</h2></div><Activity size={18}/></div><Chart points={overview.data?.data?.auctionActivity || []}/></section></div>
    <div className="analytics-grid"><section className="surface-panel"><div className="panel-heading"><div><div className="eyebrow">BID OUTCOMES</div><h2>What happened</h2></div><Gavel size={18}/></div>{(overview.data?.data?.bidOutcomes || []).map((o,i)=>{const total=Math.max(1,(overview.data?.data?.bidOutcomes || []).reduce((sum,x)=>sum+x.value,0));return <div className="outcome-row" key={o.label}><div><span>{o.label}</span><strong>{o.value}</strong></div><div className="outcome-track"><i style={{width:`${o.value/total*100}%`,background:['hsl(158 36% 34%)','hsl(15 60% 55%)','hsl(205 31% 50%)'][i%3]}}/></div></div>;})}</section><section className="surface-panel performance-panel"><div className="panel-heading"><div><div className="eyebrow">REQUEST HEALTH</div><h2>Performance</h2></div><Activity size={18}/></div>{performance.isLoading ? <div className="skeleton-line"/> : performance.isError ? <button className="arrow-link" onClick={() => performance.refetch()}>Retry performance query <ArrowRight size={14}/></button> : <><div className="performance-metrics">{[['Requests',performance.data?.data.requestCount],['Avg latency',`${performance.data?.data.averageResponseMs} ms`],['P95 latency',`${performance.data?.data.p95ResponseMs} ms`],['P99 latency',`${performance.data?.data.p99ResponseMs} ms`],['Throughput',`${performance.data?.data.throughputPerMinute}/min`],['Error rate',`${performance.data?.data.errorRatePercent}%`],['Bid processing',`${performance.data?.data.bidAverageProcessingMs} ms`]].map(([a,b])=><div key={String(a)}><span>{a}</span><strong>{b ?? '—'}</strong></div>)}</div><Chart points={performance.data?.data.responseHistory || []}/></>}</section></div>
    <div className="metrics-footer">Computed {dateTime(overview.data?.data?.generatedAt)} · Every metric reflects backend activity.</div>
  </main>;
}

function ScorePanel({ title, abbreviation, result, loading, error, retry, accent }: { title: string; abbreviation: string; result?: { score: number; formula: string; factors: { key: string; label: string; value: number; weight: number }[]; trend: { label: string; value: number }[]; comparisons: { auctionId: string; auctionTitle: string; score: number }[] }; loading: boolean; error: boolean; retry: () => void; accent: string }) {
  return <section className={`score-panel score-${accent}`}><div className="score-heading"><div><span className="eyebrow">{abbreviation} / WEIGHTED SCORE</span><h2>{title}</h2></div><div className="score-value">{loading ? '—' : result?.score ?? '—'}<small>/ 100</small></div></div>{error ? <button onClick={retry} className="arrow-link">Couldn’t load score · retry <ArrowRight size={14}/></button> : <><div className="score-meter"><i style={{width:`${Math.min(100, Math.max(0,result?.score || 0))}%`}}/></div><p className="score-formula">{result?.formula || 'Score is calculated from current marketplace activity.'}</p><div className="factor-list">{(result?.factors || []).map(f=><div key={f.key}><span>{f.label}<small>Weight {f.weight}%</small></span><strong>{f.value}</strong></div>)}</div><div className="comparison-list"><span className="comparison-label">AUCTION COMPARISONS</span>{(result?.comparisons || []).slice(0,3).map(c=><div key={c.auctionId}><span>{c.auctionTitle}</span><strong>{c.score}</strong></div>)}</div></>}</section>;
}
function Chart({ points }: { points: { label: string; value: number }[] }) { const max=Math.max(1,...points.map(p=>p.value)); return points.length ? <div className="chart"><div className="chart-bars">{points.map((p,i)=><div className="chart-column" key={`${p.label}-${i}`}><span className="chart-tip">{p.value}</span><i style={{height:`${Math.max(4,p.value/max*100)}%`}}/><small>{p.label}</small></div>)}</div></div> : <div className="chart-empty">Activity history will appear as the marketplace grows.</div>; }

function UsersPage({ user }: { user: User | null }) {
  const enabled = user?.role === 'ADMIN';
  const q = useGetUsers({ query: { enabled, queryKey: ['/api/users'] } });
  const [filter, setFilter] = useState('ALL');
  const qc = useQueryClient();
  const suspension = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      sendAdminAction(`/api/users/suspension?id=${encodeURIComponent(id)}&suspended=${suspended}`, 'PATCH'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/users'] }),
  });
  if (!enabled) return <AdminGate user={user}/>;
  const users = q.data?.data || [];
  const filtered = filter === 'ALL'
    ? users
    : filter === 'SUSPENDED'
      ? users.filter((account) => account.isSuspended)
      : users.filter((account) => account.role === filter);
  return <main className="section-wrap content-page page-enter">
    <PageTitle eyebrow="PLATFORM STUDIO / PEOPLE" title="The people in the room." detail="Review accounts and suspend or restore access when needed." action={<div className="dashboard-quick-links"><Link href="/admin/auctions" className="button button-outline"><ShieldCheck size={15}/> Listings</Link><Link href="/admin/metrics" className="button button-outline"><LineChart size={15}/> Metrics <ArrowRight size={14}/></Link></div>}/>
    <div className="users-toolbar"><span>{filtered.length} of {users.length} accounts</span><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter users"><option value="ALL">All accounts</option><option value="BUYER">Buyers</option><option value="SELLER">Sellers</option><option value="ADMIN">Admins</option><option value="SUSPENDED">Suspended</option></select></div>
    {suspension.isError && <div className="form-feedback feedback-error" role="alert">{suspension.error.message}</div>}
    {q.isLoading ? <div className="surface-panel"><div className="skeleton-line"/></div> : q.isError ? <ErrorPanel retry={()=>q.refetch()}/> : filtered.length ? <div className="users-table">
      <div className="users-table-head"><span>MEMBER</span><span>ROLE / STATUS</span><span>JOINED</span><span>LAST ACTIVE</span><span>ACCESS</span></div>
      {filtered.map(account=><div className="user-row" key={account.id} data-testid={`row-user-${account.id}`}>
        <div className="user-cell"><span className="avatar">{account.name.slice(0,1)}</span><span><strong>{account.name}</strong><small>{account.email}</small></span></div>
        <span className="user-role-cell"><Status status={account.role}/>{account.isSuspended && <Status status="SUSPENDED"/>}</span>
        <span>{dateShort(account.createdAt)}</span>
        <span>{account.lastActiveAt ? dateTime(account.lastActiveAt) : 'Not active yet'}</span>
        <span>{account.role === 'ADMIN'
          ? <small>Protected admin</small>
          : <button className={`button ${account.isSuspended ? 'button-outline' : 'button-dark'} button-small`} disabled={suspension.isPending} onClick={() => {
            const suspended = !account.isSuspended;
            if (window.confirm(`${suspended ? 'Suspend' : 'Restore'} access for ${account.name}?`)) {
              suspension.mutate({ id: account.id, suspended });
            }
          }}>{account.isSuspended ? 'Restore access' : 'Suspend access'}</button>}</span>
      </div>)}
    </div> : <EmptyState icon={<Users size={24}/>} title="No accounts in this view." detail="Change the filter to see other accounts."/>}
  </main>;
}

function AdminAuctionsPage({ user }: { user: User | null }) {
  const enabled = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const q = useGetAuctions(
    { status: 'ALL', sort: 'newest', page: 1, pageSize: 50 },
    { query: { enabled, queryKey: ['/api/auctions', 'admin-moderation'] } },
  );
  const moderation = useMutation({
    mutationFn: (id: string) => sendAdminAction(`/api/auctions/${encodeURIComponent(id)}`, 'DELETE'),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['/api/auctions'] }),
    ]),
  });
  if (!enabled) return <AdminGate user={user}/>;
  const rows = q.data?.data || [];
  return <main className="section-wrap content-page page-enter">
    <PageTitle eyebrow="PLATFORM STUDIO / MODERATION" title="Auction listings." detail="Review listings and cancel auctions that violate marketplace rules." action={<Link href="/admin/users" className="button button-outline"><Users size={15}/> Manage accounts <ArrowRight size={14}/></Link>}/>
    {moderation.isError && <div className="form-feedback feedback-error" role="alert">{moderation.error.message}</div>}
    {q.isLoading ? <AuctionSkeletons/> : q.isError ? <ErrorPanel retry={() => q.refetch()}/> : rows.length ? <div className="moderation-list">{rows.map((auction) => {
      const canCancel = auction.status !== 'COMPLETED' && auction.status !== 'CANCELLED';
      return <article className="moderation-row surface-panel" key={auction.id}>
        <div><Link href={`/auctions/${auction.id}`} className="moderation-title">{auction.title}</Link><span>{auction.sellerName} · {auction.category}</span></div>
        <div><strong>{money(auction.currentPrice)}</strong><span>{auction.bidCount} bids · {auction.uniqueBidders} bidders</span></div>
        <Status status={auction.status}/>
        {canCancel
          ? <button className="button button-outline button-small" disabled={moderation.isPending} onClick={() => {
            if (window.confirm(`Cancel "${auction.title}"? The auction and bid history will remain available for audit.`)) {
              moderation.mutate(auction.id);
            }
          }}>Cancel listing</button>
          : <span className="moderation-closed">Record retained</span>}
      </article>;
    })}</div> : <EmptyState icon={<Gavel size={24}/>} title="No listings yet." detail="Auction listings will appear here for moderation."/>}
    <p className="moderation-note">Cancellation preserves the auction and bid history for audit. Completed auctions cannot be cancelled.</p>
  </main>;
}

function NotFound() { return <main className="section-wrap content-page"><EmptyState icon={<Search size={24}/>} title="That lot is off the floor." detail="The page may have moved, or the URL is not quite right." action={<Link className="button button-dark" href="/">Back to the house <ArrowRight size={15}/></Link>}/></main>; }

export default App;
