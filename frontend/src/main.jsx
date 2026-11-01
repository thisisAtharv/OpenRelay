import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const NAV = [
  ['overview', 'Overview', '⌂'],
  ['receiver', 'Receiver', '◈'],
  ['projects', 'Projects', '▦'],
  ['keys', 'API keys', '⌁'],
  ['logs', 'Logs', '≡'],
  ['docs', 'API docs', '▤'],
  ['settings', 'Settings', '⚙'], 
];

const CAROUSEL_CARDS = [
  {
    title: 'Unified Notification API',
    badge: 'REST v1',
    icon: '⚡',
    desc: 'Ingest all application events through a single standardized endpoint. One schema drives both instant browser streams and external transactional email dispatch.',
    code: 'POST /api/v1/notifications',
    meta: 'REST JSON'
  },
  {
    title: 'Real-Time SSE Delivery',
    badge: 'EventStream',
    icon: '◈',
    desc: 'Stream live notifications to web browsers and mobile clients over native Server-Sent Events. Persistent connections, sub-10ms delivery, and automatic reconnects.',
    code: "EventSource('/events?token=...')",
    meta: 'Native HTTP/2'
  },
  {
    title: 'Queue & Replay',
    badge: 'ACID Resilient',
    icon: '≡',
    desc: 'PostgreSQL-backed offline buffering guarantees no notification is lost when subscribers disconnect. Automatically replays unacknowledged messages upon reconnect.',
    code: 'queued → delivered (ack)',
    meta: 'PostgreSQL 16'
  },
  {
    title: 'Email Notifications',
    badge: 'SMTP Engine',
    icon: '✉',
    desc: 'First-class transactional email dispatch powered by Nodemailer and Gmail SMTP. Validates recipient addresses, prevents false delivery flags, and logs SMTP timestamps.',
    code: "channel: 'email' | SMTP sent",
    meta: 'TLS Encrypted'
  },
  {
    title: 'Delivery Monitoring',
    badge: 'Telemetry',
    icon: '◎',
    desc: 'Complete developer observability with real-time stream inspection, status filtering, latency auditing, and instant payload debugging in the live receiver console.',
    code: 'status: sent | delivered | failed',
    meta: 'Instant Audit'
  }
];

const LOOP_CARDS = [...CAROUSEL_CARDS, ...CAROUSEL_CARDS, ...CAROUSEL_CARDS];

const WORKFLOW_SNIPPETS = {
  nodejs: `// 1. Dispatch notification using standard Node.js fetch
const response = await fetch('http://localhost:4000/api/v1/notifications', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer or_live_a8f902c349e18b45',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    recipient: 'user_942',
    channel: 'sse', // or 'email'
    title: 'Payment Confirmed',
    message: 'Your payment of $49.00 was successfully processed.',
    type: 'billing'
  })
});

const data = await response.json();
console.log('OpenRelay Notification ID:', data.id);`,

  python: `# 1. Dispatch notification with Python requests
import requests

url = "http://localhost:4000/api/v1/notifications"
headers = {
    "Authorization": "Bearer or_live_a8f902c349e18b45",
    "Content-Type": "application/json"
}
payload = {
    "recipient": "alex.dev@gmail.com",
    "channel": "email",
    "title": "Security Alert: New Sign-in",
    "message": "New sign-in detected from 192.168.1.42.",
    "type": "security"
}

response = requests.post(url, json=payload, headers=headers)
print("OpenRelay delivery status:", response.json()["status"])`,

  curl: `# 1. Send via unified cURL command
curl -X POST http://localhost:4000/api/v1/notifications \\
  -H "Authorization: Bearer or_live_a8f902c349e18b45" \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipient": "user_4821",
    "channel": "sse",
    "title": "Order Shipped",
    "message": "Tracking number: OR-83920194",
    "type": "order"
  }'`
};

function LandingPage({ health, onOpenAuth, copy }) {
  const [heroChannel, setHeroChannel] = useState('sse');
  const [slideIndex, setSlideIndex] = useState(CAROUSEL_CARDS.length);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [activeStep, setActiveStep] = useState(1);
  const [activeLang, setActiveLang] = useState('nodejs');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const trackRef = useRef(null);

  // Auto-advance feature carousel every 3 seconds in a continuous infinite loop
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setSlideIndex((prev) => prev + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // When transition is disabled for silent reset, re-enable transition on the next frame
  useEffect(() => {
    if (!isTransitioning) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsTransitioning(true);
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isTransitioning]);

  // Adjust track position smoothly
  useEffect(() => {
    if (!trackRef.current) return;
    const cardEl = trackRef.current.children[slideIndex];
    if (cardEl) {
      trackRef.current.style.transition = isTransitioning
        ? 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)'
        : 'none';
      trackRef.current.style.transform = `translateX(-${cardEl.offsetLeft}px)`;
    }
  }, [slideIndex, isTransitioning]);

  const handleTransitionEnd = () => {
    if (slideIndex >= CAROUSEL_CARDS.length * 2) {
      setIsTransitioning(false);
      setSlideIndex(CAROUSEL_CARDS.length);
    } else if (slideIndex < CAROUSEL_CARDS.length) {
      setIsTransitioning(false);
      setSlideIndex(slideIndex + CAROUSEL_CARDS.length);
    }
  };

  const handleNext = () => {
    setIsTransitioning(true);
    setSlideIndex((prev) => prev + 1);
  };

  const handlePrev = () => {
    setIsTransitioning(true);
    setSlideIndex((prev) => prev - 1);
  };

  const handleDotClick = (cardIdx) => {
    setIsTransitioning(true);
    setSlideIndex(CAROUSEL_CARDS.length + cardIdx);
  };

  const activeDot = slideIndex % CAROUSEL_CARDS.length;

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCopyCode = async () => {
    await copy(WORKFLOW_SNIPPETS[activeLang]);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyInstall = async () => {
    await copy('npx openrelay-client');
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const terminalData = {
    sse: {
      request: `// POST /api/v1/notifications
{
  "recipient": "user_4821",
  "channel": "sse",
  "title": "Order Shipped",
  "message": "Your order #4821 is on the way.",
  "type": "order"
}`,
      status: '201 Created',
      statusClass: 'pillGreen',
      response: `// HTTP/1.1 201 Created
{
  "id": "notif_88a4bc7102e3",
  "recipient": "user_4821",
  "channel": "sse",
  "status": "delivered",
  "acknowledged": true,
  "created_at": "2026-11-02T02:45:00Z"
}`
    },
    email: {
      request: `// POST /api/v1/notifications
{
  "recipient": "alex.dev@gmail.com",
  "channel": "email",
  "title": "Security Alert: New Sign-in",
  "message": "New sign-in detected from 192.168.1.42.",
  "type": "security"
}`,
      status: '201 Created',
      statusClass: 'pillBlue',
      response: `// HTTP/1.1 201 Created
{
  "id": "notif_99e1cc4518a2",
  "recipient": "alex.dev@gmail.com",
  "channel": "email",
  "status": "sent",
  "transport": "smtp.gmail.com",
  "created_at": "2026-11-02T02:45:00Z"
}`
    }
  };

  const workflowSteps = [
    {
      num: '01',
      title: 'Create Project & Generate API Key',
      desc: 'Set up an isolated workspace in OpenRelay. Your credentials receive scoped permissions without exposing database credentials or master admin access.'
    },
    {
      num: '02',
      title: 'Send via Unified REST Endpoint',
      desc: 'Trigger notifications with a single standard HTTP POST request. Choose between real-time browser SSE streams or transactional SMTP email with one field.'
    },
    {
      num: '03',
      title: 'Deliver & Monitor in Real Time',
      desc: 'Clients stream notifications instantly over Server-Sent Events with offline replay. Track delivery status, SMTP receipts, and logs in the developer console.'
    }
  ];

  const trustHighlights = [
    {
      icon: '🔒',
      title: 'PostgreSQL Persistence',
      desc: 'ACID-compliant storage for notifications, projects, and delivery audits with foreign keys and cascade safety.'
    },
    {
      icon: '⚡',
      title: 'Zero-Overhead SSE',
      desc: 'Native HTTP/2-friendly streaming without heavy WebSocket protocols or client library dependencies.'
    },
    {
      icon: '🛡️',
      title: 'Session & Key Isolation',
      desc: 'Dual-layer security separating developer dashboard sessions from machine-to-machine ingestion API keys.'
    },
    {
      icon: '🚀',
      title: '100% Self-Hosted & Open',
      desc: 'Complete ownership of your notification infrastructure. Run locally or in Docker with zero vendor lock-in.'
    }
  ];

  return (
    <>
      {/* Sticky Glass Navbar */}
      <header className="landingNav">
        <div className="landingNavInner">
          <div className="navBrandLink" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="brandMarkGlow">O</div>
            <span className="navBrandTitle">OpenRelay</span>
            <span className="navVersionPill">v1.2</span>
          </div>

          <div className="navLinksList" role="navigation" aria-label="Main Navigation">
            <button type="button" className="navLinkItem" onClick={() => scrollToSection('features')}>Features</button>
            <button type="button" className="navLinkItem" onClick={() => scrollToSection('how-it-works')}>How It Works</button>
            <button type="button" className="navLinkItem" onClick={() => scrollToSection('architecture')}>Architecture</button>
          </div>

          <div className="navActionsWrap">
            <span className="navStatusBadge">
              <i className="statusDotPulse"></i>
              {health ? 'API Operational' : 'Local Instance'}
            </span>
            <button type="button" className="btnGhost" onClick={() => onOpenAuth('login')}>
              Sign in
            </button>
            <button type="button" className="btnPrimaryGlow" onClick={() => onOpenAuth('register')}>
              Get Started →
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="heroSection">
        <div className="heroPillBadge">
          <span className="heroPillDot"></span>
          Open-Source Event & Notification Relay
        </div>

        <h1 className="heroHeadline">
          One API.<br />
          <span className="heroHeadlineAccent">Notifications Everywhere.</span>
        </h1>

        <p className="heroDescription">
          A developer-first, self-hosted notification engine. Route events, fan out real-time updates over Server-Sent Events (SSE), and deliver reliable transactional emails through a single authenticated endpoint.
        </p>

        <div className="heroCtasRow">
          <button type="button" className="btnPrimaryGlow btnHeroLarge" onClick={() => onOpenAuth('register')}>
            Get Started Free →
          </button>
          <button type="button" className="btnSecondaryGlass btnHeroLarge" onClick={() => scrollToSection('how-it-works')}>
            View Documentation
          </button>
        </div>

        <div className="heroInstallPill" onClick={handleCopyInstall} title="Click to copy install command">
          <code>npx openrelay-client</code>
          <span className="heroCopyBadge">{copiedInstall ? 'Copied!' : 'Copy'}</span>
        </div>

        {/* Live Interactive Terminal Preview */}
        <div className="heroTerminalWrap">
          <div className="terminalTopBar">
            <div className="terminalDots">
              <span className="dotRed"></span>
              <span className="dotYellow"></span>
              <span className="dotGreen"></span>
            </div>
            <div className="terminalEndpoint">
              <span className="methodPost">POST</span>
              <span>/api/v1/notifications</span>
            </div>
            <div className="terminalToggleWrap">
              <button
                type="button"
                className={`terminalToggleBtn ${heroChannel === 'sse' ? 'active' : ''}`}
                onClick={() => setHeroChannel('sse')}
              >
                SSE Stream
              </button>
              <button
                type="button"
                className={`terminalToggleBtn ${heroChannel === 'email' ? 'active' : ''}`}
                onClick={() => setHeroChannel('email')}
              >
                Email Delivery
              </button>
            </div>
          </div>

          <div className="terminalBodyGrid">
            <div className="terminalCodePane">
              <div className="codeHeader">
                <span>Request Payload</span>
                <span>JSON</span>
              </div>
              <pre style={{ margin: 0, overflowX: 'auto' }}>
                <code>{terminalData[heroChannel].request}</code>
              </pre>
            </div>
            <div className="terminalResponsePane">
              <div className="codeHeader">
                <span>Server Response</span>
                <span className={`responsePill ${terminalData[heroChannel].statusClass}`}>
                  {terminalData[heroChannel].status}
                </span>
              </div>
              <pre style={{ margin: 0, overflowX: 'auto' }}>
                <code>{terminalData[heroChannel].response}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Carousel Section */}
      <section id="features" className="carouselSection">
        <div className="sectionHeaderCentered">
          <span className="sectionEyebrow">Platform Capabilities</span>
          <h2 className="sectionTitle">Architected for notification resilience</h2>
          <p className="sectionSubtitle">
            Unified streaming, persistent buffering, and transactional email in one cohesive developer platform.
          </p>
        </div>

        <div className="carouselWrapper">
          <div className="carouselViewport">
            <div 
              className="carouselTrack" 
              ref={trackRef}
              onTransitionEnd={handleTransitionEnd}
            >
              {LOOP_CARDS.map((card, idx) => (
                <div
                  key={`${card.title}-${idx}`}
                  className={`carouselCardSlide ${activeDot === (idx % CAROUSEL_CARDS.length) ? 'activeCard' : ''}`}
                  onClick={() => handleDotClick(idx % CAROUSEL_CARDS.length)}
                >
                  <div className="cardHeaderRow">
                    <div className="cardIconBox">{card.icon}</div>
                    <span className="cardBadge">{card.badge}</span>
                  </div>
                  <h3 className="cardTitle">{card.title}</h3>
                  <p className="cardDesc">{card.desc}</p>
                  <div className="cardCodeSnippet">
                    <code>{card.code}</code>
                    <span>{card.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="carouselNavControls">
            <div className="carouselDotsTrack">
              {CAROUSEL_CARDS.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`carouselDotBtn ${activeDot === idx ? 'active' : ''}`}
                  onClick={() => handleDotClick(idx)}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
            <div className="carouselArrows">
              <button
                type="button"
                className="carouselArrowBtn"
                onClick={handlePrev}
                aria-label="Previous slide"
              >
                ←
              </button>
              <button
                type="button"
                className="carouselArrowBtn"
                onClick={handleNext}
                aria-label="Next slide"
              >
                →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Workflow Section */}
      <section id="how-it-works" className="workflowSection">
        <div className="sectionHeaderCentered">
          <span className="sectionEyebrow">Developer Workflow</span>
          <h2 className="sectionTitle">From zero to sending in three minutes</h2>
          <p className="sectionSubtitle">
            Integrates smoothly with any backend architecture using clean, standard HTTP requests.
          </p>
        </div>

        <div className="workflowGrid">
          <div className="workflowStepsColumn">
            {workflowSteps.map((st, i) => (
              <div
                key={st.num}
                className={`workflowStepItem ${activeStep === i + 1 ? 'activeStep' : ''}`}
                onClick={() => setActiveStep(i + 1)}
              >
                <div className="stepNumber">{st.num}</div>
                <div className="stepContent">
                  <h4>{st.title}</h4>
                  <p>{st.desc}</p>
                </div>
              </div>
            ))}
            <div style={{ marginTop: '10px' }}>
              <button type="button" className="btnPrimaryGlow" onClick={() => onOpenAuth('register')}>
                Get Started Now →
              </button>
            </div>
          </div>

          <div className="workflowCodeViewer">
            <div className="codeViewerTabs">
              <div className="codeTabGroup">
                {['nodejs', 'python', 'curl'].map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`codeTabBtn ${activeLang === lang ? 'active' : ''}`}
                    onClick={() => setActiveLang(lang)}
                  >
                    {lang === 'nodejs' ? 'Node.js' : lang === 'python' ? 'Python' : 'cURL'}
                  </button>
                ))}
              </div>
              <button type="button" className="codeCopyBtn" onClick={handleCopyCode}>
                {copiedCode ? '✓ Copied' : 'Copy code'}
              </button>
            </div>
            <pre className="codeSnippetArea">
              <code>{WORKFLOW_SNIPPETS[activeLang]}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Architecture / Trust Highlights */}
      <section id="architecture" className="trustGridSection">
        <div className="sectionHeaderCentered">
          <span className="sectionEyebrow">Architecture & Reliability</span>
          <h2 className="sectionTitle">Engineered for control and stability</h2>
          <p className="sectionSubtitle">
            Predictable throughput, zero proprietary dependencies, and full deployment freedom.
          </p>
        </div>
        <div className="trustGrid">
          {trustHighlights.map((it) => (
            <div key={it.title} className="trustCard">
              <div className="trustIcon">{it.icon}</div>
              <h4>{it.title}</h4>
              <p>{it.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Clean Footer */}
      <footer className="landingFooter">
        <div className="footerInner">
          <div className="footerBrandCol">
            <div className="navBrandLink" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="brandMarkGlow">O</div>
              <span className="navBrandTitle">OpenRelay</span>
            </div>
            <p>
              Self-hosted developer notification engine with unified Server-Sent Events (SSE) and SMTP email delivery.
            </p>
          </div>

          <div className="footerLinksCol">
            <h5>Product</h5>
            <div className="footerLinksList">
              <a className="footerLink" onClick={() => scrollToSection('features')}>Features</a>
              <a className="footerLink" onClick={() => scrollToSection('how-it-works')}>How It Works</a>
              <a className="footerLink" onClick={() => scrollToSection('architecture')}>Architecture</a>
            </div>
          </div>

          <div className="footerLinksCol">
            <h5>Resources</h5>
            <div className="footerLinksList">
              <a className="footerLink" onClick={() => scrollToSection('how-it-works')}>Node.js SDK</a>
              <a className="footerLink" onClick={() => scrollToSection('how-it-works')}>Python Client</a>
              <a className="footerLink" onClick={() => scrollToSection('how-it-works')}>cURL Examples</a>
            </div>
          </div>

          <div className="footerLinksCol">
            <h5>Account</h5>
            <div className="footerLinksList">
              <a className="footerLink" onClick={() => onOpenAuth('login')}>Sign In to Console</a>
              <a className="footerLink" onClick={() => onOpenAuth('register')}>Create Account</a>
            </div>
          </div>
        </div>

        <div className="footerBottomBar">
          <span>© {new Date().getFullYear()} OpenRelay Project. All rights reserved.</span>
          <span>MIT Licensed • Self-Hosted & Secure</span>
        </div>
      </footer>
    </>
  );
}


function ResetPasswordPage({ token, onBackToLogin, request }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function verify() {
      try {
        const data = await request('/api/auth/verify-reset-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        if (mounted) {
          if (data.valid) {
            setTokenValid(true);
          } else {
            setTokenValid(false);
            setTokenError(data.error || 'Password reset link is invalid or has expired.');
          }
        }
      } catch (err) {
        if (mounted) {
          setTokenValid(false);
          setTokenError(err.message || 'Password reset link is invalid or has expired.');
        }
      } finally {
        if (mounted) setVerifying(false);
      }
    }
    verify();
    return () => { mounted = false; };
  }, [token, request]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password) {
      return setError('Please enter a new password.');
    }
    if (password.length < 8) {
      return setError('Password must be at least 8 characters long.');
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match. Please verify both fields.');
    }

    setSubmitting(true);
    try {
      await request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to reset password. Please request a new link.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="resetPageContainer">
      <div className="resetCard">
        <div className="resetHeader">
          <div className="authBrandMark">O</div>
          <h2 className="resetTitle">Reset Your Password</h2>
          <p className="resetSub">OpenRelay Account Security</p>
        </div>

        {verifying ? (
          <div className="resetLoading">
            <div className="resetSpinner"></div>
            <p>Verifying secure reset token...</p>
          </div>
        ) : !tokenValid ? (
          <div className="resetErrorCard">
            <div className="resetAlertBadge error">Expired or Invalid Link</div>
            <p>{tokenError || 'This password reset link is invalid or has already expired.'}</p>
            <button type="button" className="authSubmitButton" onClick={onBackToLogin}>
              Return to Sign In
            </button>
          </div>
        ) : success ? (
          <div className="resetSuccessCard">
            <div className="resetAlertBadge success">Password Updated</div>
            <p>Your password has been successfully reset. You can now sign in with your new credentials.</p>
            <button type="button" className="authSubmitButton" onClick={onBackToLogin}>
              Sign In to OpenRelay
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="authForm" noValidate>
            {error && (
              <div className="authErrorAlert" role="alert">
                <span className="authErrorIcon">!</span>
                <span>{error}</span>
              </div>
            )}

            <div className="authFieldGroup">
              <label htmlFor="reset-new-password">New password</label>
              <div className="authInputWrap">
                <input
                  id="reset-new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Minimum 8 characters"
                  className="inputHasToggle"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="passwordToggleBtn"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="authFieldGroup">
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <div className="authInputWrap">
                <input
                  id="reset-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  placeholder="Re-enter your new password"
                  required
                />
              </div>
              <div className="authValidationHint">
                Minimum 8 characters. Make sure passwords match.
              </div>
            </div>

            <button type="submit" className="authSubmitButton" disabled={submitting}>
              {submitting ? 'Updating password...' : 'Update Password'}
            </button>

            <button type="button" className="resetCancelBtn" onClick={onBackToLogin}>
              Cancel and return to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}


function AuthModal({ mode, onSwitchMode, onClose, onSuccess, request }) {
  const [authMode, setAuthMode] = useState(mode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  useEffect(() => {
    setAuthMode(mode);
    setError('');
    setForgotSent(false);
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const switchTab = (newMode) => {
    setAuthMode(newMode);
    setError('');
    setForgotSent(false);
    onSwitchMode?.(newMode);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return setError('Email address is required.');
    }
    if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(trimmedEmail)) {
      return setError('Please enter a valid email address.');
    }

    if (authMode === 'forgot') {
      setBusy(true);
      try {
        await request('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail })
        });
        setForgotSent(true);
      } catch (err) {
        setError(err.message || 'Failed to send reset link. Please try again.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!password) {
      return setError('Password is required.');
    }
    if (password.length < 8) {
      return setError('Password must be at least 8 characters long.');
    }

    setBusy(true);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = {
        email: trimmedEmail,
        password,
        ...(authMode === 'register' && name.trim() ? { name: name.trim() } : {})
      };
      const data = await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      onSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authBackdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="authModalCard">
        <button type="button" className="authCloseBtn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>

        <div className="authModalHeader">
          <div className="authBrandMark">O</div>
          <h2 className="authModalTitle">
            {authMode === 'register' ? 'Create your account' : authMode === 'forgot' ? 'Reset your password' : 'Welcome back'}
          </h2>
          <p className="authModalSub">
            {authMode === 'register'
              ? 'Start managing notifications with OpenRelay Console'
              : authMode === 'forgot'
              ? 'Enter your email address to receive a secure password reset link'
              : 'Sign in to access your projects and API keys'}
          </p>
        </div>

        {authMode !== 'forgot' && (
          <div className="authSegmentedTabs">
            <button
              type="button"
              className={`authTabBtn ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => switchTab('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`authTabBtn ${authMode === 'register' ? 'active' : ''}`}
              onClick={() => switchTab('register')}
            >
              Create account
            </button>
          </div>
        )}

        {error && (
          <div className="authErrorAlert" role="alert">
            <span className="authErrorIcon">!</span>
            <span>{error}</span>
          </div>
        )}

        {authMode === 'forgot' && forgotSent ? (
          <div className="authConfirmationBox">
            <div className="authConfirmationIcon">✓</div>
            <h3>Check your email</h3>
            <p>If an account exists with this email, a password reset link has been sent. Please check your inbox and spam folder.</p>
            <button type="button" className="authSubmitButton" onClick={() => switchTab('login')}>
              Return to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="authForm" noValidate>
            {authMode === 'register' && (
              <div className="authFieldGroup">
                <label htmlFor="auth-name">Your name</label>
                <div className="authInputWrap">
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setError(''); }}
                    placeholder="Alex Developer"
                    maxLength="80"
                    autoFocus
                  />
                </div>
              </div>
            )}

            <div className="authFieldGroup">
              <label htmlFor="auth-email">Email address</label>
              <div className="authInputWrap">
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="developer@example.com"
                  required
                  autoComplete="email"
                  autoFocus={authMode === 'login' || authMode === 'forgot'}
                />
              </div>
            </div>

            {authMode !== 'forgot' && (
              <div className="authFieldGroup">
                <div className="authLabelRow">
                  <label htmlFor="auth-password">Password</label>
                  {authMode === 'login' && (
                    <button
                      type="button"
                      className="authForgotLink"
                      onClick={() => switchTab('forgot')}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="authInputWrap">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    placeholder="Minimum 8 characters"
                    className="inputHasToggle"
                    required
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    className="passwordToggleBtn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="authValidationHint">
                  {authMode === 'register'
                    ? 'Minimum 8 characters. Passwords are securely hashed with bcrypt.'
                    : 'Enter your account password.'}
                </div>
              </div>
            )}

            <button type="submit" className="authSubmitButton" disabled={busy}>
              {busy
                ? 'Please wait…'
                : authMode === 'register'
                ? 'Create account'
                : authMode === 'forgot'
                ? 'Send reset link'
                : 'Sign in'}
            </button>
          </form>
        )}

        <div className="authModalFooter">
          {authMode === 'register' ? (
            <>
              Already have an account?{' '}
              <button type="button" className="authSwitchLink" onClick={() => switchTab('login')}>
                Sign in
              </button>
            </>
          ) : authMode === 'forgot' ? (
            <>
              Remember your password?{' '}
              <button type="button" className="authSwitchLink" onClick={() => switchTab('login')}>
                Back to sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{' '}
              <button type="button" className="authSwitchLink" onClick={() => switchTab('register')}>
                Create one
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('overview');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keys, setKeys] = useState([]);
  const [logs, setLogs] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('openrelay-theme') || 'dark');
  const [health, setHealth] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [newProject, setNewProject] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [channel, setChannel] = useState('sse');
  const [recipient, setRecipient] = useState('user_123');
  const [title, setTitle] = useState('Order shipped');
  const [message, setMessage] = useState('Your order #4821 has been shipped.');
  const [type, setType] = useState('general');

  // Reset password token detection from URL query params
  const [resetToken, setResetToken] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('token') || params.get('reset_token') || null;
    } catch {
      return null;
    }
  });

  // Dashboard User Authentication state
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const request = async (path, options = {}) => {
    const r = await fetch(`${API}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  };
  const auth = () => apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const setCurrentKey = (value) => { setApiKey(value); if (project && value) sessionStorage.setItem(`openrelay-key:${project.id}`, value); };
  const notify = (message, kind = 'success') => {
    setToast({ message, kind });
    clearTimeout(window.__orToast);
    window.__orToast = setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('openrelay-theme', theme); }, [theme]);
  useEffect(() => {
    checkSession();
    checkHealth();
    const t = setInterval(checkHealth, 10000);
    return () => clearInterval(t);
  }, []);

  async function checkSession() {
    try {
      const data = await request('/api/auth/me');
      setUser(data.user);
      await loadProjects();
    } catch {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  }

  async function handleLogout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setProject(null);
      setProjects([]);
      setApiKey('');
      setLogs([]);
      setKeys([]);
      setAuthModalOpen(false);
      notify('Signed out.');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  useEffect(() => {
    if (!project) { setApiKey(''); return; }
    const cached = sessionStorage.getItem(`openrelay-key:${project.id}`) || '';
    setApiKey(cached);
    setShowKey(false);
  }, [project?.id]);

  useEffect(() => {
    if (!project || !apiKey) return;
    sessionStorage.setItem(`openrelay-key:${project.id}`, apiKey);
    loadLogs(); loadKeys();
    let source;
    try {
      source = new EventSource(`${API}/api/projects/${project.id}/events?token=${encodeURIComponent(apiKey)}`);
      source.onmessage = (event) => {
        try { const payload = JSON.parse(event.data); if (payload.event?.startsWith('notification.')) loadLogs(); } catch {}
      };
    } catch {}
    return () => source?.close();
  }, [project?.id, apiKey]);

  async function checkHealth() { try { const d = await request('/health'); setHealth(Boolean(d.ok)); } catch { setHealth(false); } }
  async function loadProjects() {
    try {
      const data = await request('/api/projects'); setProjects(data);
      if (project) { const fresh = data.find(p => p.id === project.id); if (fresh) setProject(fresh); }
      else if (data[0]) setProject(data[0]);
    } catch (e) {
      if (!String(e.message).includes('Authentication')) notify(e.message, 'error');
    }
  }
  async function loadLogs() { if (!project || !apiKey) return; try { setLogs(await request(`/api/projects/${project.id}/notifications?limit=200`, { headers: auth() })); } catch (e) { if (!String(e.message).includes('Invalid')) notify(e.message, 'error'); } }
  async function loadKeys() { if (!project || !apiKey) return; try { setKeys(await request(`/api/projects/${project.id}/keys`, { headers: auth() })); } catch (e) { if (!String(e.message).includes('Invalid')) notify(e.message, 'error'); } }

  async function createProject(e) {
    e.preventDefault(); const name = newProject.trim(); if (!name) return;
    setBusy(true);
    try { const d = await request('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name}) }); setNewProject(''); setProject(d.project); setCurrentKey(d.apiKey); await loadProjects(); setModal({type:'new-key', key:d.apiKey, title:'Project created'}); notify('Project created successfully.'); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  async function createKey(e) {
    e.preventDefault(); if (!project || !apiKey) return notify('Select a project and enter an active API key.','error');
    setBusy(true);
    try { const d = await request(`/api/projects/${project.id}/keys`, { method:'POST', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify({name:newKeyName.trim() || 'API key'}) }); setNewKeyName(''); setCurrentKey(d.apiKey); await loadKeys(); setModal({type:'new-key',key:d.apiKey,title:'API key created'}); notify('New API key created.'); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  async function revokeKey(id) {
    try { await request(`/api/projects/${project.id}/keys/${id}/revoke`, {method:'POST',headers:auth()}); await loadKeys(); notify('API key revoked.'); }
    catch(e){ notify(e.message,'error'); }
  }
  async function deleteProject(targetProject) {
    const target = targetProject || modal?.project || project;
    if (!target) return notify('No project selected to delete.', 'error');
    setBusy(true);
    try {
      await request(`/api/projects/${target.id}`, { method: 'DELETE' });
      const deleted = target.name;
      setModal(null);
      if (project?.id === target.id) {
        setProject(null);
        setApiKey('');
        setLogs([]);
        setKeys([]);
      }
      sessionStorage.removeItem(`openrelay-key:${target.id}`);
      await loadProjects();
      setPage('projects');
      notify(`Deleted ${deleted}.`);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function sendNotification(e) {
    e.preventDefault(); if (!apiKey) return notify('Enter a project API key first.','error');
    if (!recipient.trim() || !title.trim() || !message.trim()) return notify('Recipient, title and message are required.','error');
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      return notify('Please enter a valid recipient email address.','error');
    }
    setBusy(true);
    try {
      const d = await request('/api/v1/notifications', {
        method:'POST',
        headers:{...auth(),'Content-Type':'application/json'},
        body:JSON.stringify({recipient: recipient.trim(), title: title.trim(), message: message.trim(), type, channel})
      });
      const statusMsg = d.status === 'sent' ? 'sent via email' : 'queued';
      notify(`Notification ${d.id.slice(0,8)} ${statusMsg}.`);
      await loadLogs();
      setPage('logs');
    }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); } catch { notify('Copy failed. Select and copy manually.','error'); } };

  const stats = useMemo(() => ({
    total: logs.length,
    delivered: logs.filter(x=>x.status==='delivered').length,
    sent: logs.filter(x=>x.status==='sent').length,
    queued: logs.filter(x=>x.status==='queued').length,
    failed: logs.filter(x=>x.status==='failed').length,
  }), [logs]);
  const filteredLogs = useMemo(() => logs.filter(n => {
    const q = search.trim().toLowerCase();
    const matchesQ = !q || [n.id,n.recipient,n.title,n.message,n.channel].some(v => String(v||'').toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'all' || n.status === statusFilter;
    const matchesChannel = channelFilter === 'all' || (n.channel || 'sse') === channelFilter;
    return matchesQ && matchesStatus && matchesChannel;
  }), [logs,search,statusFilter,channelFilter]);

  if (!authChecked) {
    return <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Loading OpenRelay…</div>
    </div>;
  }

  if (resetToken && !user) {
    return (
      <div className="landingShell">
        <ResetPasswordPage
          token={resetToken}
          onBackToLogin={() => {
            setResetToken(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('token');
              url.searchParams.delete('reset_token');
              window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
            } catch {}
            setAuthMode('login');
            setAuthModalOpen(true);
          }}
          request={request}
        />
        {toast && (
          <div className={`toast ${toast.kind}`}>
            <span>{toast.kind === 'success' ? '✓' : '!'}</span>
            <b>{toast.message}</b>
            <button onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="landingShell">
        <LandingPage
          health={health}
          onOpenAuth={(mode) => {
            setAuthMode(mode || 'login');
            setAuthModalOpen(true);
          }}
          copy={copy}
        />
        {authModalOpen && (
          <AuthModal
            mode={authMode}
            onSwitchMode={(mode) => setAuthMode(mode)}
            onClose={() => setAuthModalOpen(false)}
            onSuccess={(authenticatedUser) => {
              setUser(authenticatedUser);
              setAuthModalOpen(false);
              notify(authMode === 'register' ? 'Account created successfully!' : 'Signed in successfully!');
              loadProjects();
            }}
            request={request}
          />
        )}
        {toast && (
          <div className={`toast ${toast.kind}`}>
            <span>{toast.kind === 'success' ? '✓' : '!'}</span>
            <b>{toast.message}</b>
            <button onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark">O</div><div><strong>OpenRelay</strong><span>Self-hosted notifications</span></div></div>
      <div className="userBadgeSide">
        <div className="userInfo">
          <div className="userAvatar">{user.name ? user.name.slice(0, 1).toUpperCase() : user.email.slice(0, 1).toUpperCase()}</div>
          <div className="userMeta">
            <b>{user.name || user.email.split('@')[0]}</b>
            <small>{user.email}</small>
          </div>
        </div>
        <button className="logoutBtn" title="Sign out" onClick={handleLogout}>Sign out</button>
      </div>
      <div className="projectSelectSide">
        <span>WORKSPACE</span>
        <select value={project?.id || ''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);setProject(p||null);}}><option value="">Select project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <nav>{NAV.map(([id,label,icon])=><button key={id} className={page===id?'navItem active':'navItem'} onClick={()=>setPage(id)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebarBottom"><div className="instance"><i className={health?'online':'offline'}></i><div><b>{health?'Operational':'Offline'}</b><small>Local instance</small></div></div><button className="themeMini" onClick={()=>setTheme(theme==='dark'?'light':'dark')}><span>{theme==='dark'?'☀':'☾'}</span>{theme==='dark'?'Light mode':'Dark mode'}</button></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="mobileBrand"><div className="brandMark">O</div><b>OpenRelay</b></div>
        <div><div className="eyebrow">Developer console</div><h1>{NAV.find(x=>x[0]===page)?.[1]}</h1><p>{page==='overview'?'Send, inspect and debug notifications from one lightweight console.':page==='receiver'?'Real-time notification listener via Server-Sent Events (SSE).':page==='projects'?'Organize notification traffic by application.':page==='keys'?'Manage the credentials your applications use.':page==='logs'?'Monitor delivery activity and troubleshoot failures.':page==='docs'?'Copy the integration you need and ship.':'Control appearance and instance details.'}</p></div>
        <div className="topActions"><span className="healthBadge"><i className={health?'online':'offline'}></i>{health?'All systems operational':'API unavailable'}</span></div>
      </header>

      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind==='success'?'✓':'!'}</span><b>{toast.message}</b><button onClick={()=>setToast(null)}>×</button></div>}

      {page==='overview' && <>
        <div className="heroBar">
          <div><span className="sectionLabel">ACTIVE PROJECT</span><div className="projectPicker"><select value={project?.id||''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);setProject(p||null);}}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button onClick={()=>setPage('projects')}>Manage projects</button></div></div>
          <form className="newProjectForm" onSubmit={createProject}><input value={newProject} onChange={e=>setNewProject(e.target.value)} placeholder="New project name" maxLength="80"/><button disabled={busy}>{busy?'Creating…':'New project'}</button></form>
        </div>
        {!project ? <EmptyState icon="＋" title="Create your first project" text="A project keeps API keys, notification history and monitoring isolated for one application." action="Create project" onClick={()=>document.querySelector('.newProjectForm input')?.focus()}/> : <>
          <div className="statGrid"><Stat label="Total notifications" value={stats.total} hint="Last 200 records"/><Stat label="Delivered" value={stats.delivered} tone="green" hint="SSE acknowledged"/><Stat label="Sent" value={stats.sent} tone="blue" hint="SMTP accepted"/><Stat label="Queued" value={stats.queued} tone="amber" hint="Waiting for delivery"/><Stat label="Failed" value={stats.failed} tone="red" hint="Needs investigation"/></div>
          <div className="grid2">
            <Panel title="Send a notification" subtitle="Test the same authenticated endpoint your app will use.">
              <form className="form" onSubmit={sendNotification}>
                <Field label="Project API key">
                  <div className="keyInput">
                    <input value={apiKey} onChange={e=>setCurrentKey(e.target.value)} placeholder="Paste or_live_…" autoComplete="off" type={showKey?'text':'password'}/>
                    <button type="button" onClick={()=>setShowKey(v=>!v)}>{showKey?'Hide':'Show'}</button>
                    <button type="button" onClick={()=>{setApiKey(''); if(project) sessionStorage.removeItem(`openrelay-key:${project.id}`);}}>Clear</button>
                  </div>
                </Field>
                <div className="formRow">
                  <Field label="Delivery channel">
                    <select value={channel} onChange={e=>{
                      const c = e.target.value;
                      setChannel(c);
                      if (c === 'email' && recipient === 'user_123') setRecipient('user@example.com');
                      else if (c === 'sse' && recipient === 'user@example.com') setRecipient('user_123');
                    }}>
                      <option value="sse">SSE (Real-time Stream)</option>
                      <option value="email">Email (Gmail SMTP)</option>
                    </select>
                  </Field>
                  <Field label="Type">
                    <select value={type} onChange={e=>setType(e.target.value)}>
                      <option>general</option>
                      <option>order</option>
                      <option>alert</option>
                      <option>system</option>
                    </select>
                  </Field>
                </div>
                <Field label={channel==='email'?'Recipient email address':'Recipient identifier'}>
                  <input
                    value={recipient}
                    onChange={e=>setRecipient(e.target.value)}
                    placeholder={channel==='email'?'user@example.com':'user_123'}
                    type={channel==='email'?'email':'text'}
                  />
                </Field>
                <Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)} maxLength="160"/></Field>
                <Field label="Message"><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength="4000"/></Field>
                <button className="primary wide" disabled={busy}>{busy?'Sending…':'Send notification'} <span>→</span></button>
              </form>
            </Panel>
            <Panel title="Quick integration" subtitle="One authenticated request. No dashboard dependency.">
              <Code text={`curl -X POST ${API}/api/v1/notifications \\\n  -H "Authorization: Bearer or_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "recipient": "${channel==='email'?'user@example.com':'user_123'}",\n    "channel": "${channel}",\n    "title": "Order Shipped",\n    "message": "Your order is on the way."\n  }'`} onCopy={()=>copy(`curl -X POST ${API}/api/v1/notifications`)} />
              <div className="infoCallout"><span>i</span><div><b>Multi-channel by design</b><p>OpenRelay supports real-time SSE stream delivery and standard SMTP email delivery through a unified API.</p></div></div>
              <button className="textButton" onClick={()=>setPage('docs')}>View API documentation →</button>
            </Panel>
          </div>
          <LogTable logs={logs.slice(0,6)} onView={()=>setPage('logs')}/>
        </>}
      </>}

      {page==='receiver' && <ReceiverPage project={project} apiKey={apiKey} request={request} auth={auth} notify={notify} setPage={setPage} copy={copy} />}

      {page==='projects' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">WORKSPACE</span><h2>Your projects</h2><p>Each project has its own API keys and notification history.</p></div><form className="createInline" onSubmit={createProject}><input value={newProject} onChange={e=>setNewProject(e.target.value)} placeholder="Project name"/><button className="primary" disabled={busy}>Create project</button></form></div><div className="projectGrid">{projects.map(p=><article className={`projectCard ${project?.id===p.id?'selected':''}`} key={p.id}><button className="projectMain" onClick={()=>{setProject(p);setPage('overview')}}><div className="projectAvatar">{p.name.slice(0,1).toUpperCase()}</div><div><h3>{p.name}</h3><span>{p.notification_count||0} notifications</span><small>{new Date(p.created_at).toLocaleDateString()}</small></div></button><div className="cardActions"><button onClick={()=>{setProject(p);setPage('overview')}}>Open</button><button className="dangerText" onClick={()=>setModal({type:'delete-project',project:p})}>Delete</button></div></article>)}</div>{!projects.length&&<EmptyState icon="▦" title="No projects yet" text="Create a project to get an API key and start sending notifications."/>}</section>}

      {page==='keys' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">CREDENTIALS</span><h2>API keys</h2><p>Keys authenticate requests to your OpenRelay instance.</p></div><div className="projectPill">{project?project.name:'No project selected'}</div></div>{project&&apiKey?<><form className="createKey" onSubmit={createKey}><input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key name, e.g. Production"/><button className="primary" disabled={busy}>{busy?'Generating…':'Generate API key'}</button></form><div className="securityNote"><span>⌁</span><div><b>Store keys like passwords</b><p>The full secret is only displayed once when created. OpenRelay stores a hash, not the raw key.</p></div></div><div className="keyList">{keys.map(k=><div className="keyRow" key={k.id}><div className="keyIdentity"><div className="keyIcon">⌁</div><div><b>{k.name}</b><span>{k.key_prefix}••••••••</span></div></div><div className="keyMeta"><span className={k.revoked_at?'status revoked':'status active'}>{k.revoked_at?'Revoked':'Active'}</span><small>{k.last_used_at?`Last used ${new Date(k.last_used_at).toLocaleString()}`:`Created ${new Date(k.created_at).toLocaleDateString()}`}</small>{!k.revoked_at&&<button className="dangerOutline" onClick={()=>setModal({type:'revoke-key',key:k})}>Revoke</button>}</div></div>)}{!keys.length&&<EmptyState icon="⌁" title="No API keys" text="Create a key for this project to authenticate your application."/>}</div></>:<EmptyState icon="⌁" title="Select a project" text="Choose a project and enter one of its active API keys on Overview to manage credentials." action="Go to overview" onClick={()=>setPage('overview')}/>}</section>}

      {page==='logs' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">MONITORING</span><h2>Notification logs</h2><p>Search and inspect delivery activity for the active project.</p></div><div className="logStats"><span><b>{stats.total}</b>Total</span><span><b className="greenText">{stats.delivered}</b>Delivered</span><span><b className="blueText">{stats.sent}</b>Sent</span><span><b className="amberText">{stats.queued}</b>Queued</span><span><b className="redText">{stats.failed}</b>Failed</span></div></div>{project&&apiKey?<><div className="filters"><div className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipient, title, ID or channel…"/></div><select value={channelFilter} onChange={e=>setChannelFilter(e.target.value)}><option value="all">All channels</option><option value="sse">SSE</option><option value="email">Email</option></select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="delivered">Delivered</option><option value="sent">Sent</option><option value="queued">Queued</option><option value="failed">Failed</option></select></div><LogTable logs={filteredLogs} full/></>:<EmptyState icon="≡" title="Nothing to monitor yet" text="Select a project and provide an active API key to load its notification history." action="Go to overview" onClick={()=>setPage('overview')}/>}</section>}

      {page==='docs' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">DEVELOPER API</span><h2>API documentation</h2><p>Everything needed to send and inspect notifications across delivery channels.</p></div></div><div className="docsGrid"><Panel title="Create notification" subtitle="POST /api/v1/notifications"><Code text={`POST ${API}/api/v1/notifications\nAuthorization: Bearer or_live_...\nContent-Type: application/json\n\n{\n  "recipient": "user@example.com",\n  "channel": "email",\n  "title": "Order Shipped",\n  "message": "Your order is on the way.",\n  "type": "order"\n}`} onCopy={()=>copy(`POST ${API}/api/v1/notifications`)}/><p className="docText">Channels supported: <code>sse</code> (default real-time stream) and <code>email</code> (SMTP dispatch). Email recipients must be valid email addresses.</p></Panel><Panel title="Responses" subtitle="Lifecycle status"><Code text={`// SSE response (202 Accepted):\n{\n  "id": "uuid-123",\n  "status": "queued",\n  "channel": "sse"\n}\n\n// Email response (200 OK):\n{\n  "id": "uuid-456",\n  "status": "sent",\n  "channel": "email"\n}`} /><p className="docText">SMTP acceptance records <code>sent</code> (not falsely marked delivered). Check status anytime:</p><Code text={`GET ${API}/api/v1/notifications/:id\nAuthorization: Bearer or_live_...`} /></Panel></div></section>}

      {page==='settings' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">PREFERENCES</span><h2>Settings</h2><p>Keep the console comfortable and your instance easy to understand.</p></div></div><div className="settingsGrid"><Panel title="Appearance" subtitle="Choose the interface theme"><div className="themeCards"><button className={theme==='light'?'themeCard selected':'themeCard'} onClick={()=>setTheme('light')}><div className="preview lightPreview"><i></i><i></i><i></i></div><b>Light</b><span>Clean and bright</span></button><button className={theme==='dark'?'themeCard selected':'themeCard'} onClick={()=>setTheme('dark')}><div className="preview darkPreview"><i></i><i></i><i></i></div><b>Dark</b><span>Low-light interface</span></button></div></Panel><Panel title="Instance" subtitle="Current OpenRelay environment"><div className="settingsList"><div><span>Dashboard</span><b>localhost:5173</b></div><div><span>API</span><b>localhost:4000</b></div><div><span>Database</span><b>PostgreSQL 16</b></div><div><span>Status</span><b className={health?'greenText':'redText'}>{health?'Operational':'Unavailable'}</b></div><div><span>Deployment</span><b>Docker Compose</b></div></div></Panel></div><Panel title="Self-hosting" subtitle="Deployment guidance"><div className="selfHostCopy"><b>Your infrastructure, your data.</b><p>Run OpenRelay on your own Linux VM or server. Put Nginx in front of the dashboard and API, keep PostgreSQL private, enable HTTPS and provide secrets through environment variables.</p></div></Panel>{project&&<Panel title="Danger zone" subtitle={`Destructive actions for ${project.name}`} danger><div className="dangerBox"><div><b>Delete project</b><p>Permanently removes the project, API keys and notification history.</p></div><button className="dangerButton" onClick={()=>setModal({type:'delete-project',project})}>Delete project</button></div></Panel>}</section>}
    </main>

    {modal && <Modal modal={modal} onClose={()=>setModal(null)} onCopy={copy} onDelete={deleteProject} onRevoke={()=>{revokeKey(modal.key.id);setModal(null)}} busy={busy}/>} 
  </div>;
}

function Modal({modal,onClose,onCopy,onDelete,onRevoke,busy}) {
  if(modal.type==='new-key') return <div className="modalBackdrop"><div className="modal"><div className="modalIcon success">✓</div><h3>{modal.title}</h3><p>This secret is shown only once. Copy it now and store it securely.</p><div className="secretBox"><code>{modal.key}</code><button onClick={()=>onCopy(modal.key)}>Copy</button></div><button className="primary wide" onClick={onClose}>Done</button></div></div>;
  if(modal.type==='revoke-key') return <div className="modalBackdrop"><div className="modal"><div className="modalIcon warning">!</div><h3>Revoke API key?</h3><p><b>{modal.key.name}</b> will immediately stop authenticating requests. This cannot be undone.</p><div className="modalActions"><button className="secondary" onClick={onClose}>Cancel</button><button className="dangerButton" onClick={onRevoke}>Revoke key</button></div></div></div>;
  return <div className="modalBackdrop"><div className="modal"><div className="modalIcon dangerIcon">!</div><h3>Delete “{modal.project.name}”?</h3><p>This permanently removes the project, all API keys and notification logs. Type the project name to confirm.</p><input autoFocus placeholder={modal.project.name} onKeyDown={e=>{if(e.key==='Enter'&&e.currentTarget.value===modal.project.name)onDelete(modal.project);}}/><div className="modalActions"><button className="secondary" onClick={onClose}>Cancel</button><button className="dangerButton" disabled={busy} onClick={(e)=>{const input=e.currentTarget.parentElement.previousElementSibling;if(input.value===modal.project.name)onDelete(modal.project);}}>{busy?'Deleting…':'Delete project'}</button></div></div></div>;
}
function Stat({label,value,hint,tone=''}){return <div className="statCard"><div className={`statDot ${tone}`}></div><span>{label}</span><b>{value}</b><small>{hint}</small></div>}
function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>}
function Panel({title,subtitle,children,danger=false}){return <section className={danger?'panel dangerPanel':'panel'}><div className="panelHead"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div></div>{children}</section>}
function Code({text,onCopy}){return <div className="codeWrap"><pre><code>{text}</code></pre>{onCopy&&<button className="copyButton" onClick={onCopy}>Copy</button>}</div>}
function EmptyState({icon,title,text,action,onClick}){return <div className="emptyState"><div className="emptyIcon">{icon}</div><h3>{title}</h3><p>{text}</p>{action&&<button className="primary" onClick={onClick}>{action}</button>}</div>}
function LogTable({logs,onView,full=false}){
  return <section className="panel logPanel">
    <div className="panelHead"><div><h3>{full?'Activity':'Recent notifications'}</h3><p>{full?'Latest delivery records for the selected project.':'The latest notification activity.'}</p></div>{onView&&logs.length>0&&<button className="textButton" onClick={onView}>View all →</button>}</div>
    {!logs.length?<div className="emptyTable">No notifications match your current view.</div>:<div className="tableScroll">
      <div className="logTable">
        <div className="logRow header"><span>Notification</span><span>Recipient / Channel</span><span>Status</span><span>Created</span></div>
        {logs.map(n=><div className="logRow" key={n.id}>
          <span><b>{n.title}</b><p className='notificationMessage'>{n.message}</p> <small>{n.id}</small></span>
          <span>
            <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
              <span>{n.recipient}</span>
              <span className={`channelBadge ${n.channel||'sse'}`}>{n.channel||'sse'}</span>
            </div>
          </span>
          <span>
            <i className={`statusDot ${n.status}`}></i>{n.status}
            {n.status==='sent'&&<small style={{display:'block',color:'var(--muted-2)'}}>{n.sent_at?`SMTP ${new Date(n.sent_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'SMTP accepted'}</small>}
            {n.status==='failed'&&n.error_message&&<small style={{display:'block',color:'var(--red)'}} title={n.error_message}>{n.error_message.slice(0,32)}…</small>}
          </span>
          <span>{new Date(n.created_at).toLocaleString()}</span>
        </div>)}
      </div>
    </div>}
  </section>;
}

function ReceiverPage({ project, apiKey, request, auth, notify, setPage, copy }) {
  const [feed, setFeed] = useState([]);
  const [pendingBuffer, setPendingBuffer] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connStatus, setConnStatus] = useState(!project || !apiKey ? 'disconnected' : 'connecting');
  const [sessionCount, setSessionCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [reconnectKey, setReconnectKey] = useState(0);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!project || !apiKey) return;
    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) {
        setLoading(true);
        setError(null);
      }
    });

    request(`/api/projects/${project.id}/notifications?limit=50`, { headers: auth() })
      .then((data) => {
        if (isMounted) {
          setFeed(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [project?.id, apiKey, reconnectKey]);

  useEffect(() => {
    if (!project || !apiKey) return;

    let source;
    try {
      queueMicrotask(() => setConnStatus('connecting'));
      source = new EventSource(`${API}/api/projects/${project.id}/events?token=${encodeURIComponent(apiKey)}`);

      source.onopen = () => {
        setConnStatus('connected');
        setError(null);
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.event === 'connected') {
            setConnStatus('connected');
            return;
          }

          if (payload.event === 'notification.created') {
            const raw = payload.data || payload;
            const ch = raw.channel || 'sse';
            const newNotif = {
              id: raw.id,
              recipient: raw.recipient,
              title: raw.title,
              message: raw.message,
              type: raw.type || 'general',
              channel: ch,
              status: raw.status || (ch === 'email' ? 'sent' : 'queued'),
              created_at: raw.created_at || new Date().toISOString(),
              sent_at: raw.sent_at,
              isLive: true,
              raw: payload
            };

            setSessionCount(prev => prev + 1);

            if (pausedRef.current) {
              setPendingBuffer(prev => [newNotif, ...prev.filter(x => x.id !== newNotif.id)]);
            } else {
              setFeed(prev => [newNotif, ...prev.filter(x => x.id !== newNotif.id)]);
            }

            // CRITICAL: Ensure email notifications are NOT automatically acknowledged by the SSE Receiver!
            if (ch === 'sse' && (raw.status === 'queued' || !raw.status)) {
              request(`/api/v1/notifications/${raw.id}/ack`, {
                method: 'POST',
                headers: auth()
              })
                .then((ackRes) => {
                  if (ackRes?.status) {
                    setFeed(prev => prev.map(item => (item.id === raw.id ? { ...item, status: ackRes.status } : item)));
                    setPendingBuffer(prev => prev.map(item => (item.id === raw.id ? { ...item, status: ackRes.status } : item)));
                  }
                })
                .catch((err) => {
                  console.error(`Acknowledgement failed for notification ${raw.id}:`, err);
                  notify(`Failed to acknowledge notification ${raw.id?.slice(0, 8)}: ${err.message}`, 'error');
                });
            }
          } else if (payload.event === 'notification.updated') {
            const raw = payload.data || payload;
            setFeed(prev => prev.map(item => (item.id === raw.id ? { ...item, status: raw.status || item.status } : item)));
          }
        } catch (e) {
          console.error('SSE event parse error:', e);
        }
      };

      source.onerror = () => {
        if (source.readyState === EventSource.CONNECTING) {
          setConnStatus('reconnecting');
        } else if (source.readyState === EventSource.CLOSED) {
          setConnStatus('disconnected');
        }
      };
    } catch (err) {
      queueMicrotask(() => {
        setConnStatus('error');
        setError(err.message);
      });
    }

    return () => {
      source?.close();
    };
  }, [project?.id, apiKey, reconnectKey]);

  const flushBuffer = () => {
    if (pendingBuffer.length > 0) {
      setFeed(prev => {
        const ids = new Set(pendingBuffer.map(p => p.id));
        return [...pendingBuffer, ...prev.filter(x => !ids.has(x.id))];
      });
      setPendingBuffer([]);
    }
  };

  const togglePause = () => {
    if (paused && pendingBuffer.length > 0) {
      flushBuffer();
    }
    setPaused(!paused);
  };

  const clearFeed = () => {
    setFeed([]);
    setPendingBuffer([]);
    notify('Receiver feed cleared.');
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredFeed = useMemo(() => {
    return feed.filter(item => {
      const q = search.trim().toLowerCase();
      const matchesQ = !q || [item.id, item.recipient, item.title, item.message].some(v => String(v || '').toLowerCase().includes(q));
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesType = typeFilter === 'all' || (item.type || 'general') === typeFilter;
      return matchesQ && matchesStatus && matchesType;
    });
  }, [feed, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: feed.length,
    queued: feed.filter(x => x.status === 'queued').length,
    delivered: feed.filter(x => x.status === 'delivered').length,
    sent: feed.filter(x => x.status === 'sent').length,
    failed: feed.filter(x => x.status === 'failed').length,
  }), [feed]);

  if (!project || !apiKey) {
    return (
      <section className="pageSection">
        <div className="pageIntro">
          <div>
            <span className="sectionLabel">LIVE RECEIVER</span>
            <h2>Notification Receiver</h2>
            <p>Connect to real-time Server-Sent Events to receive and inspect notifications as they arrive.</p>
          </div>
        </div>
        <EmptyState 
          icon="◈" 
          title="Select a project and API key" 
          text="Choose a project and ensure an active API key is set on Overview to connect to the SSE receiver stream." 
          action="Go to overview" 
          onClick={() => setPage('overview')} 
        />
      </section>
    );
  }

  return (
    <section className="pageSection">
      <div className="pageIntro">
        <div>
          <span className="sectionLabel">LIVE RECEIVER</span>
          <h2>Notification Receiver</h2>
          <p>Listening for real-time notifications on <b>{project.name}</b></p>
        </div>
        <div className="receiverHeaderActions">
          <div className={`connectionPill ${connStatus}`} title={`Status: ${connStatus}`}>
            <i className={`liveDot ${connStatus}`}></i>
            <span>{connStatus === 'connected' ? 'Connected (Live)' : connStatus === 'connecting' ? 'Connecting…' : connStatus === 'reconnecting' ? 'Reconnecting…' : connStatus === 'error' ? 'Connection Error' : 'Disconnected'}</span>
          </div>
          <button className="secondary" onClick={() => setReconnectKey(k => k + 1)} title="Restart SSE connection">
            ↻ Reconnect
          </button>
        </div>
      </div>

      <div className="statGrid">
        <Stat label="Total in feed" value={stats.total} hint="Current receiver records" />
        <Stat label="Received live" value={sessionCount} tone="green" hint="Arrived during this session" />
        <Stat label="Delivered status" value={stats.delivered} tone="green" hint="SSE confirmed" />
        <Stat label="Sent status" value={stats.sent} tone="blue" hint="SMTP accepted" />
      </div>

      {error && (
        <div className="receiverErrorBanner">
          <div className="errorIcon">!</div>
          <div className="errorContent">
            <b>Connection Error</b>
            <p>{error}</p>
          </div>
          <button className="secondary" onClick={() => setReconnectKey(k => k + 1)}>Retry</button>
        </div>
      )}

      <div className="receiverToolbar">
        <div className="search">
          <span>⌕</span>
          <input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Filter by recipient, title, message or ID…" 
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="general">general</option>
          <option value="order">order</option>
          <option value="alert">alert</option>
          <option value="system">system</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="delivered">Delivered</option>
          <option value="sent">Sent</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
        <button 
          className={`receiverBtn ${paused ? 'active' : ''}`} 
          onClick={togglePause}
          title={paused ? 'Resume live stream updates' : 'Pause incoming live updates'}
        >
          {paused ? '▶ Resume stream' : '❚❚ Pause stream'}
        </button>
        <button 
          className="receiverBtn" 
          onClick={clearFeed} 
          disabled={feed.length === 0}
          title="Clear the current receiver feed"
        >
          Clear feed
        </button>
      </div>

      {paused && pendingBuffer.length > 0 && (
        <div className="pendingNotice" onClick={flushBuffer}>
          <span>⚡ {pendingBuffer.length} new notification{pendingBuffer.length > 1 ? 's' : ''} received while paused</span>
          <button type="button">Show now →</button>
        </div>
      )}

      {loading ? (
        <div className="receiverLoadingState">
          <div className="receiverLoadingSpinner"></div>
          <b>Connecting to notification stream…</b>
          <p>Initializing SSE connection and loading recent records for {project.name}</p>
        </div>
      ) : filteredFeed.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">◈</div>
          <h3>{feed.length === 0 ? 'Waiting for notifications' : 'No matching notifications'}</h3>
          <p>
            {feed.length === 0 
              ? `Connected to SSE stream for ${project.name}. As soon as a notification is published, it will appear here in real time.` 
              : 'No notifications match your current search and filter criteria.'}
          </p>
          {feed.length === 0 && (
            <button className="primary" onClick={() => setPage('overview')}>Send a test notification →</button>
          )}
        </div>
      ) : (
        <div className="receiverFeed">
          {filteredFeed.map(item => (
            <article className={`receiverCard ${item.isLive ? 'livePulseCard' : ''}`} key={item.id}>
              <div className="receiverCardHeader">
                <div className="receiverCardTitleGroup">
                  <div className="receiverTitleRow">
                    <h4>{item.title}</h4>
                    {item.isLive && <span className="liveBadge">LIVE</span>}
                  </div>
                  <p className="receiverMessage">{item.message}</p>
                </div>
                <div className="receiverCardMeta">
                  <span className="receiverMetaItem">
                    <i className={`statusDot ${item.status}`}></i>
                    {item.status}
                  </span>
                  <span className="typeBadge">{item.type || 'general'}</span>
                  <span className={`channelBadge ${item.channel || 'sse'}`}>{item.channel || 'sse'}</span>
                  <time title={new Date(item.created_at).toLocaleString()}>
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </time>
                </div>
              </div>

              <div className="receiverCardFooter">
                <div className="receiverFooterLeft">
                  <span className="recipientTag">Recipient: <b>{item.recipient}</b></span>
                  <span className="idTag" onClick={() => copy(item.id)} title="Click to copy ID">
                    <code>{item.id}</code>
                  </span>
                </div>
                <button 
                  className="payloadToggleBtn" 
                  onClick={() => toggleExpand(item.id)}
                >
                  {expandedIds.has(item.id) ? 'Hide payload ▲' : 'Inspect payload ▼'}
                </button>
              </div>

              {expandedIds.has(item.id) && (
                <div className="payloadViewer">
                  <Code 
                    text={JSON.stringify(item.raw || item, null, 2)} 
                    onCopy={() => copy(JSON.stringify(item.raw || item, null, 2))} 
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
