import { useNavigate } from 'react-router-dom';
import { useUISettings } from '../../context/UISettingsContext';
import './ListItemLanding.css';

function SellerIcon({ type }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
  };

  if (type === 'reach') {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="m4 16 5-5 4 4 7-8" />
        <path d="M15 7h5v5" />
      </svg>
    );
  }

  if (type === 'payments') {
    return (
      <svg aria-hidden="true" {...common}>
        <rect height="13" rx="2" width="18" x="3" y="6" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" {...common}>
      <path d="M4 7h16" />
      <path d="M7 7v12" />
      <path d="M17 7v12" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
      <path d="M6 4h12l2 3H4l2-3Z" />
    </svg>
  );
}

function LogoMark({ brandName, logoUrl }) {
  return logoUrl ? <img alt={brandName} src={logoUrl} /> : <span>{brandName.slice(0, 2).toUpperCase()}</span>;
}

export default function ListItemLanding() {
  const navigate = useNavigate();
  const { settings } = useUISettings();
  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const logoUrl = settings.logo_url?.trim() || '';
  const primary = settings.primary_color || '#00202e';
  const secondary = settings.secondary_color || '#515567';
  const background = settings.tertiary_color || '#ffffff';
  const primaryText = settings.primary_text_color || '#17313b';

  return (
    <div
      className="list-item-public-page"
      style={{
        '--seller-bg': background,
        '--seller-primary': primary,
        '--seller-primary-text': primaryText,
        '--seller-secondary': secondary,
      }}
    >
      <header className="seller-nav">
        <button className="seller-brand" onClick={() => navigate('/')} type="button">
          <span className="seller-brand-mark">
            <LogoMark brandName={brandName} logoUrl={logoUrl} />
          </span>
          <strong>{brandName}</strong>
        </button>

        <nav aria-label="Seller links" className="seller-nav-links">
          <button onClick={() => navigate('/')} type="button">Home</button>
          <button onClick={() => navigate('/login')} type="button">Login</button>
        </nav>
      </header>

      <main className="seller-main">
        <section className="seller-hero">
          <div className="seller-hero-copy">
            <span>List smarter, earn locally</span>
            <h1>Grow your rentals with {brandName}</h1>
            <p>
              Turn unused items into income. Reach nearby borrowers, manage listings, and receive secure payments
              through one organized rental dashboard.
            </p>
            <div className="seller-hero-actions">
              <button onClick={() => navigate('/signup')} type="button">Register now</button>
              <button onClick={() => navigate('/login')} type="button">Already have an account</button>
            </div>
          </div>

          <div aria-hidden="true" className="seller-hero-visual">
            <div className="seller-portrait">
              <span />
              <i />
            </div>
            <div className="seller-boxes">
              <b />
              <b />
              <b />
              <b />
              <b />
              <b />
            </div>
          </div>
        </section>

        <section className="seller-benefits">
          <h2>Why list on {brandName}?</h2>
          <div className="seller-benefit-grid">
            <article>
              <span className="seller-benefit-icon"><SellerIcon type="reach" /></span>
              <h3>Local reach</h3>
              <p>Show your rental items to verified community members looking for short-term access nearby.</p>
            </article>
            <article>
              <span className="seller-benefit-icon"><SellerIcon type="payments" /></span>
              <h3>Secure payments</h3>
              <p>Track deposits, rental income, purchase requests, and transaction history from your dashboard.</p>
              <div className="seller-payment-tags">
                <span>GCash</span>
                <span>Maya</span>
              </div>
            </article>
            <article>
              <span className="seller-benefit-icon"><SellerIcon type="tools" /></span>
              <h3>Owner tools</h3>
              <p>Manage inventory, booking approvals, saved items, reports, and messages in one owner workspace.</p>
            </article>
          </div>
        </section>

        <section className="seller-cta">
          <h2>Ready to start listing?</h2>
          <p>Set up your account, verify your profile, and publish your first rentable item.</p>
          <button onClick={() => navigate('/signup')} type="button">Create owner account</button>
        </section>
      </main>
    </div>
  );
}
