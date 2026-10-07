import { useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { setAuthTokenGetter, useAddToWatchlist, useCreateAuction, useGetAuction, useGetAuctionBids, useGetAuctions, useGetBiddingEngagement, useGetAuctionFairness, useGetCurrentUser, useGetDashboardSummary, useGetMetricsOverview, useGetMyBids, useGetNotifications, useGetPerformanceMetrics, useGetTransactions, useGetUsers, useGetWatchlist, useLogin, useLogout, useMarkAllNotificationsRead, useMarkNotificationRead, usePlaceBid, useRegister, useRemoveFromWatchlist } from '@workspace/api-client-react';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Bell, Check, ChevronLeft, ChevronRight, Clock3, Gavel, Heart, LineChart, LogIn, LogOut, Menu, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, Users, X } from 'lucide-react';
import type { Auction, GetAuctionsParams, User } from '@workspace/api-client-react';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 12_000 } } });
const tokenKey = 'auction-house-token';
setAuthTokenGetter(() => localStorage.getItem(tokenKey));
const money = (v?: number) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateShort = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const dateTime = (d?: string) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const timeLeft = (end?: string) => {
  if (!end) return '—';
  const ms = new Date(end).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const hrs = Math.floor(ms / 3_600_000), days = Math.floor(hrs / 24);
  return days ? `${days}d ${hrs % 24}h` : hrs ? `${hrs}h ${Math.floor(ms / 60_000) % 60}m` : `${Math.max(1, Math.floor(ms / 60_000))}m`;
};
const titleCase = (s = '') => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell /></WouterRouter></QueryClientProvider>;
}

function Shell() {
  const [loc] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const current = useGetCurrentUser({ query: { enabled: !!token, queryKey: ['/api/auth/me'] } });
  const user = current.data?.success ? current.data.data : null;
  const notifications = useGetNotifications({ query: { enabled: !!token, queryKey: ['/api/notifications'], refetchInterval: 45_000 } });
  const logout = useLogout();
  const qc = useQueryClient();
  useEffect(() => { setMenuOpen(false); }, [loc]);
  const onLogout = () => logout.mutate(undefined, { onSuccess: () => { localStorage.removeItem(tokenKey); setToken(null); qc.clear(); } });
  return <div className="grain min-h-[100dvh]">
    <header className="site-header">
      <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Gavel size={17} /></span><span>LOT<span className="brand-dot">.</span>HOUSE</span></Link>
      <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
        <Link href="/auctions" className={loc.startsWith('/auctions') ? 'nav-active' : ''}>Explore</Link>
        {user && <Link href="/dashboard" className={loc === '/dashboard' ? 'nav-active' : ''}>My space</Link>}
        {user?.role === 'ADMIN' && <Link href="/admin/metrics" className={loc.startsWith('/admin') ? 'nav-active' : ''}>Studio</Link>}
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
      <Route path="/admin/metrics" component={MetricsPage}/>
      <Route path="/admin/users" component={UsersPage}/>
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
        <div className="card-price-row"><div><span className="price-label">{isLive ? 'Current bid' : auction.status === 'UPCOMING' ? 'Starting at' : 'Final price'}</span><strong>{money(isLive ? auction.currentPrice : auction.startingPrice)}</strong></div><div className="time-tag"><Clock3 size={14}/>{auction.status === 'UPCOMING' ? `Starts ${dateShort(auction.startAt)}` : timeLeft(auction.endAt)}</div></div>
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
  const bidsQuery = useGetAuctionBids(id, { query: { queryKey: ['/api/auctions', id, 'bids'], refetchInterval: 8_000 } });
  const userQuery = useGetCurrentUser({ query: { enabled: !!localStorage.getItem(tokenKey), queryKey: ['/api/auth/me'] } });
  const auction = auctionQuery.data?.data;
  const placeBid = usePlaceBid();
  const [amount, setAmount] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(() => getSavedIds().includes(id));
  const add = useAddToWatchlist(), remove = useRemoveFromWatchlist();
  const minBid = auction ? auction.currentPrice + auction.increment : 0;
  useEffect(() => { if (auction) setAmount(String(minBid)); }, [auction?.id, auction?.currentPrice, auction?.increment]);
  if (auctionQuery.isLoading) return <main className="section-wrap content-page"><div className="detail-skeleton"/></main>;
  if (auctionQuery.isError || !auction) return <main className="section-wrap content-page"><ErrorPanel retry={() => auctionQuery.refetch()}/></main>;
  const bidSubmit = (e: FormEvent) => { e.preventDefault(); setFeedback(''); placeBid.mutate({ auctionId: id, data: { amount: Number(amount) } }, { onSuccess: async r => { setFeedback(r.message || 'Your bid is in.'); await Promise.all([qc.invalidateQueries({ queryKey: ['/api/auctions'] }), qc.invalidateQueries({ queryKey: ['/api/auctions', id] }), qc.invalidateQueries({ queryKey: ['/api/auctions', id, 'bids'] })]); }, onError: err => setFeedback(err.message || 'Bid could not be placed.') }); };
  const toggleWatch = () => (saved ? remove : add).mutate({ auctionId: id }, { onSuccess: () => { setSaved(!saved); persistSavedId(id, !saved); } });
  const bids = bidsQuery.data?.data || [];
  return <main className="page-enter section-wrap content-page"><div className="breadcrumb"><Link href="/auctions">Auctions</Link><ChevronRight size={14}/><span>{auction.category}</span></div><div className="auction-detail">
    <div className="detail-visual"><div className="detail-image">{auction.imageUrl ? <img src={auction.imageUrl} alt={auction.title}/> : <div className="image-placeholder large"><Gavel size={55}/><span>LOT HOUSE / OBJECT Nº {id.slice(-3)}</span></div>}<div className="detail-image-tag">LOT Nº {id.slice(-5).toUpperCase()}</div></div><div className="detail-image-caption"><span>DOCUMENTED OBJECT</span><span>SELLER: {auction.sellerName}</span></div></div>
    <div className="detail-info"><div className="eyebrow">{auction.category} / LOT {id.slice(-4)}</div><div className="detail-title-line"><h1>{auction.title}</h1><Status status={auction.status}/></div><p className="detail-description">{auction.description}</p><div className="seller-line"><span className="avatar small-avatar">{auction.sellerName.slice(0,1)}</span><span>Offered by <strong>{auction.sellerName}</strong></span><span className="seller-trust"><ShieldCheck size={15}/> Verified seller</span></div>
      <div className="bid-panel"><div className="bid-panel-top"><span>{auction.status === 'UPCOMING' ? 'Opening bid' : auction.status === 'COMPLETED' ? 'Sold for' : 'Current bid'}</span><span className="live-indicator">{auction.status === 'LIVE' || auction.status === 'ENDING_SOON' ? <><i/> LIVE AUCTION</> : titleCase(auction.status)}</span></div><strong className="current-price">{money(auction.currentPrice)}</strong><div className="bid-panel-meta"><span>{auction.bidCount} bids · {auction.uniqueBidders} bidders</span><span><Clock3 size={14}/>{auction.status === 'UPCOMING' ? `Opens ${dateTime(auction.startAt)}` : timeLeft(auction.endAt)} left</span></div>
        {auction.status === 'LIVE' || auction.status === 'ENDING_SOON' ? <form onSubmit={bidSubmit} className="bid-form"><label htmlFor="bid-amount">Your bid <span>Minimum {money(minBid)}</span></label><div className="bid-input"><span>$</span><input id="bid-amount" type="number" min={minBid} step={auction.increment} value={amount} onChange={e => setAmount(e.target.value)} required data-testid="input-bid-amount"/><button className="button button-dark" disabled={placeBid.isPending || !userQuery.data?.success} data-testid="button-place-bid">{placeBid.isPending ? 'Submitting…' : 'Place bid'} <ArrowRight size={16}/></button></div>{!userQuery.data?.success && <Link href="/login" className="signin-hint">Sign in to join the bidding <ArrowRight size={13}/></Link>}{feedback && <div className={`form-feedback ${placeBid.isError ? 'feedback-error' : ''}`}>{feedback}</div>}</form> : <div className="closed-notice">{auction.status === 'UPCOMING' ? 'This lot is not open for bidding yet.' : 'Bidding has closed for this lot.'}</div>}
        <button className={`watch-detail ${saved ? 'saved' : ''}`} onClick={toggleWatch} data-testid="button-detail-watch"><Heart size={17} fill={saved ? 'currentColor' : 'none'}/>{saved ? 'Saved to your watchlist' : 'Add to watchlist'}</button>
      </div>
      <div className="auction-facts"><div><span>Starting price</span><strong>{money(auction.startingPrice)}</strong></div><div><span>Bid increment</span><strong>{money(auction.increment)}</strong></div><div><span>Closes</span><strong>{dateTime(auction.endAt)}</strong></div></div>
      <div className="fairness-note"><ShieldCheck size={19}/><div><strong>A fair room, by design.</strong><span>Every bid is timestamped and validated. See the full activity record below.</span></div></div>
    </div></div>
    <section className="bid-history"><div className="section-head"><div><div className="eyebrow">THE ROOM, IN REAL TIME</div><h2>Bid history<span className="accent-dot">.</span></h2></div><span className="refresh-note"><span className="live-dot"/> Updates automatically</span></div>{bidsQuery.isLoading ? <div className="skeleton-line"/> : bids.length ? <div className="history-table"><div className="history-head"><span>Bidder</span><span>Placed</span><span>Bid amount</span><span>Result</span></div>{bids.map((b, i) => <div className="history-row" key={b.id} data-testid={`row-bid-${b.id}`}><span><span className="history-avatar">{b.bidderName.slice(0,1)}</span>{b.bidderName}{i === 0 && b.status === 'ACCEPTED' && <em>Leading</em>}</span><span>{dateTime(b.placedAt)}</span><strong>{money(b.amount)}</strong><Status status={b.status}/></div>)}</div> : <div className="history-empty">No bids have been placed. The opening move is yours.</div>}</section>
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
  return <main className="auth-layout page-enter"><div className="auth-story"><Link href="/" className="brand"><span className="brand-mark"><Gavel size={16}/></span><span>LOT<span className="brand-dot">.</span>HOUSE</span></Link><div className="auth-story-copy"><div className="eyebrow">THE ROOM IS OPEN</div><h1>For the things<br/>you’ll <em>keep.</em></h1><p>Join a marketplace where every bid has a timestamp, every seller has a name, and every object has another chapter.</p></div><div className="auth-story-foot"><ShieldCheck size={18}/> Built around fair bidding and real activity.</div></div><div className="auth-form-wrap"><div className="auth-form-inner"><div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'MAKE YOURSELF AT HOME'}</div><h2>{mode === 'login' ? 'Good to see you.' : 'Start with a name.'}</h2><p>{mode === 'login' ? 'Sign in to follow the lots and join the room.' : 'Create an account to bid, save, or sell.'}</p><form className="stack-form" onSubmit={submit}>{mode === 'register' && <label>Your name<input name="name" minLength={2} maxLength={80} autoComplete="name" required placeholder="How should we call you?" data-testid="input-name"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" data-testid="input-email"/></label><label>Password<input name="password" type="password" minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="At least 8 characters" data-testid="input-password"/></label>{mode === 'register' && <label>I'm here to…<select name="role" defaultValue="BUYER" data-testid="select-role"><option value="BUYER">Find and bid on good things</option><option value="SELLER">Offer something worth finding</option></select></label>}{error && <div className="form-feedback feedback-error" role="alert">{error}</div>}<button className="button button-dark full-button" disabled={busy} data-testid="button-auth-submit">{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create your account'}<ArrowRight size={16}/></button></form><div className="auth-switch">{mode === 'login' ? <>New to the house? <Link href="/register">Create an account</Link></> : <>Already have a seat? <Link href="/login">Sign in</Link></>}</div></div><div className="auth-smallprint">By continuing, you agree to keep the room fair.</div></div></main>;
}

function DashboardPage({ user }: { user: User | null }) {
  const summary = useGetDashboardSummary({ query: { enabled: !!user, queryKey: ['/api/dashboard/summary'] } });
  const myBids = useGetMyBids({ query: { enabled: !!user && user.role === 'BUYER', queryKey: ['/api/me/bids'] } });
  if (!user) return <AuthGate title="Your own corner of the room." detail="Sign in to see bids, saved lots, and the latest activity." />;
  const s = summary.data?.data;
  const buyer = user.role === 'BUYER';
  const cards = buyer ? [['Active bids', s?.activeBidCount], ['Lots won', s?.wonCount], ['Watchlist', s?.watchlistCount], ['Total spent', money(s?.totalSpending)]] : [['Your lots', s?.totalAuctions], ['Live now', s?.liveAuctions], ['Completed', s?.completedAuctions], ['Seller revenue', money(s?.sellerRevenue)]];
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow={`${user.role} / OVERVIEW`} title={`Good to have you, ${user.name.split(' ')[0]}.`} detail={buyer ? 'Your bids, saved lots, and wins—all in one place.' : 'Your listings and the people finding them.'} action={user.role === 'SELLER' ? <Link href="/seller/auctions/new" className="button button-dark"><Plus size={16}/> New listing</Link> : <Link href="/auctions" className="button button-dark">Find a lot <ArrowRight size={15}/></Link>}/>{summary.isLoading ? <div className="metric-skeletons">{[0,1,2,3].map(n=><div key={n} className="skeleton-card"/>)}</div> : summary.isError ? <ErrorPanel retry={() => summary.refetch()}/> : <><div className="stat-grid">{cards.map(([label,value])=><div className="stat-card" key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong><small>From real marketplace activity</small></div>)}</div><div className="dashboard-columns"><section className="surface-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT SIGNAL</div><h2>Activity</h2></div><Activity size={18}/></div>{s?.recentActivity?.length ? <div className="activity-list">{s.recentActivity.map(a=><div key={a.id} className="activity-item"><span className="activity-mark"><i/></span><div><strong>{a.title}</strong><span>{a.detail}</span></div><time>{dateShort(a.createdAt)}</time></div>)}</div> : <EmptyState icon={<Activity size={23}/>} title="A clean slate." detail="Your activity will show up here as you take part."/>}</section><section className="surface-panel"><div className="panel-heading"><div><div className="eyebrow">{buyer ? 'BID POSITION' : 'SELLER TOOLKIT'}</div><h2>{buyer ? 'Your bids' : 'Make a good first impression'}</h2></div>{buyer ? <Gavel size={18}/> : <Sparkles size={18}/>}</div>{buyer ? myBids.isLoading ? <div className="skeleton-line"/> : myBids.data?.data?.length ? <div className="my-bids-list">{myBids.data.data.slice(0,5).map(item=><Link href={`/auctions/${item.auction.id}`} className="my-bid-row" key={item.bid.id}><span>{item.auction.title}<small>{item.bid.bidderName === user.name ? money(item.bid.amount) : money(item.auction.currentPrice)}</small></span><span className={item.leading ? 'leading-tag' : 'outbid-tag'}>{item.leading ? 'Leading' : 'Outbid'}</span><ArrowRight size={15}/></Link>)}</div> : <EmptyState icon={<Gavel size={23}/>} title="No bids placed yet." detail="A good find starts with a first bid." action={<Link href="/auctions" className="arrow-link">Explore auctions <ArrowRight size={15}/></Link>}/> : <div className="seller-prompt"><p>List an object you love. Track its bids and find it a new home.</p><Link href="/seller/auctions/new" className="button button-outline">Start a listing <ArrowRight size={15}/></Link><Link href="/transactions" className="arrow-link">View transactions <ArrowRight size={15}/></Link></div>}</section></div></>}</main>;
}

function AuthGate({ title, detail }: { title: string; detail: string }) { return <main className="section-wrap content-page"><EmptyState icon={<LogIn size={24}/>} title={title} detail={detail} action={<Link href="/login" className="button button-dark">Sign in <ArrowRight size={15}/></Link>}/></main>; }

function CreateListingPage({ user }: { user: User | null }) {
  const create = useCreateAuction(); const qc = useQueryClient(); const [, setLocation] = useLocation(); const [error, setError] = useState('');
  if (!user) return <AuthGate title="Ready to offer something?" detail="Sign in as a seller to create and manage your lots." />;
  if (user.role !== 'SELLER' && user.role !== 'ADMIN') return <main className="section-wrap content-page"><EmptyState icon={<ShieldCheck size={24}/>} title="Seller access required." detail="This account is set up for bidding. Create a seller account to list an item." action={<Link href="/register" className="button button-dark">Create seller account <ArrowRight size={15}/></Link>}/></main>;
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); const f = new FormData(e.currentTarget); create.mutate({ data: { title: String(f.get('title')), description: String(f.get('description')), category: String(f.get('category')), imageUrl: String(f.get('imageUrl')), startingPrice: Number(f.get('startingPrice')), increment: Number(f.get('increment')), startAt: new Date(String(f.get('startAt'))).toISOString(), endAt: new Date(String(f.get('endAt'))).toISOString() } }, { onSuccess: res => { if (!res.success) { setError(res.message); return; } qc.invalidateQueries({ queryKey: ['/api/auctions'] }); setLocation(`/auctions/${res.data.id}`); }, onError: err => setError(err.message) }); };
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="SELLER STUDIO / NEW LOT" title="Give it a new chapter." detail="Tell the room what makes this one worth finding."/><div className="listing-layout"><form className="listing-form surface-panel" onSubmit={submit}><div className="form-section-label"><span>01</span> The object</div><label>Listing title<input name="title" required minLength={3} maxLength={100} placeholder="A name with a little character" data-testid="input-listing-title"/></label><label>Story and condition<textarea name="description" required minLength={20} maxLength={3000} rows={5} placeholder="History, details, condition—what should its next owner know?" data-testid="input-listing-description"/></label><div className="form-two"><label>Category<input name="category" required minLength={2} maxLength={60} placeholder="Ceramics, design, books…" data-testid="input-listing-category"/></label><label>Image URL<input name="imageUrl" type="url" required maxLength={1000} placeholder="https://…" data-testid="input-listing-image"/></label></div><div className="form-section-label form-section-spaced"><span>02</span> The auction</div><div className="form-two"><label>Starting price ($)<input name="startingPrice" type="number" min="0.01" step="0.01" required placeholder="120.00" data-testid="input-start-price"/></label><label>Bid increment ($)<input name="increment" type="number" min="0.01" step="0.01" required placeholder="5.00" data-testid="input-increment"/></label><label>Opens<input name="startAt" type="datetime-local" required data-testid="input-start-date"/></label><label>Closes<input name="endAt" type="datetime-local" required data-testid="input-end-date"/></label></div>{error && <div className="form-feedback feedback-error">{error}</div>}<div className="listing-submit"><span><ShieldCheck size={16}/> Bids are server-validated and timestamped.</span><button className="button button-dark" disabled={create.isPending} data-testid="button-create-auction">{create.isPending ? 'Publishing…' : 'Publish listing'} <ArrowRight size={16}/></button></div></form><aside className="listing-aside"><div className="eyebrow">A NOTE TO SELLERS</div><h3>Good details make good auctions.</h3><p>A clear title, honest condition notes, and a useful image help the right person find your lot.</p><div className="aside-rule"/><div className="aside-check"><Check size={15}/> Start and end times are shown in your local timezone.</div><div className="aside-check"><Check size={15}/> Your bids and sale are recorded in activity metrics.</div><div className="aside-check"><Check size={15}/> You can track buyer engagement from the dashboard.</div></aside></div></main>;
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
  return { ...result, ids: Array.isArray(result.data?.data) ? result.data.data as unknown as string[] : getSavedIds() };
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

function MetricsPage() {
  const overview = useGetMetricsOverview({ query: { queryKey: ['/api/admin/metrics/overview'], refetchInterval: 60_000 } });
  const engagement = useGetBiddingEngagement({ query: { queryKey: ['/api/admin/metrics/engagement'], refetchInterval: 60_000 } });
  const fairness = useGetAuctionFairness({ query: { queryKey: ['/api/admin/metrics/fairness'], refetchInterval: 60_000 } });
  const performance = useGetPerformanceMetrics({ query: { queryKey: ['/api/admin/metrics/performance'], refetchInterval: 30_000 } });
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

function UsersPage() {
  const q = useGetUsers({ query: { queryKey: ['/api/admin/users'] } });
  const [filter, setFilter] = useState('ALL');
  const users = q.data?.data || [];
  const filtered=filter==='ALL'?users:users.filter(u=>u.role===filter);
  return <main className="section-wrap content-page page-enter"><PageTitle eyebrow="PLATFORM STUDIO / PEOPLE" title="The people in the room." detail="Account activity and participation, from the live platform." action={<Link href="/admin/metrics" className="button button-outline"><LineChart size={15}/> Metrics <ArrowRight size={14}/></Link>}/><div className="users-toolbar"><span>{users.length} accounts</span><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter users"><option value="ALL">All roles</option><option value="BUYER">Buyers</option><option value="SELLER">Sellers</option><option value="ADMIN">Admins</option></select></div>{q.isLoading ? <div className="surface-panel"><div className="skeleton-line"/></div> : q.isError ? <ErrorPanel retry={()=>q.refetch()}/> : filtered.length ? <div className="users-table"><div className="users-table-head"><span>MEMBER</span><span>ROLE</span><span>JOINED</span><span>LAST ACTIVE</span></div>{filtered.map(u=><div className="user-row" key={u.id} data-testid={`row-user-${u.id}`}><div className="user-cell"><span className="avatar">{u.name.slice(0,1)}</span><span><strong>{u.name}</strong><small>{u.email}</small></span></div><span><Status status={u.role}/></span><span>{dateShort(u.createdAt)}</span><span>{u.lastActiveAt ? dateTime(u.lastActiveAt) : 'Not active yet'}</span></div>)}</div> : <EmptyState icon={<Users size={24}/>} title="No accounts in this view." detail="Change the role filter to see other members."/>}</main>;
}

function NotFound() { return <main className="section-wrap content-page"><EmptyState icon={<Search size={24}/>} title="That lot is off the floor." detail="The page may have moved, or the URL is not quite right." action={<Link className="button button-dark" href="/">Back to the house <ArrowRight size={15}/></Link>}/></main>; }

export default App;
