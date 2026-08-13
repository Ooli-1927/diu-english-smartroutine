import type { ReactNode } from 'react';

type Props = {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  /** admin = large h1 in console; page = student/teacher h2 with optional icon */
  variant?: 'admin' | 'page';
  className?: string;
};

export function PageHero({
  kicker,
  title,
  subtitle,
  icon,
  actions,
  trailing,
  variant = 'admin',
  className = '',
}: Props) {
  return (
    <header className={`page-hero page-hero--${variant} ${className}`.trim()}>
      <img
        className="page-hero__crest"
        src="/branding/diu-english-dept-logo.png?v=4"
        alt=""
        aria-hidden
      />
      <div className="page-hero__main">
        {icon ? <div className="grad-icon page-hero__icon">{icon}</div> : null}
        <div className="page-hero__copy">
          <div className="page-hero__identity">
            <img src="/branding/diu-english-dept-logo.png?v=4" alt="" />
            <span>DIU · Department of English</span>
          </div>
          {kicker ? <span className="brand-kicker">{kicker}</span> : null}
          {variant === 'admin' ? <h1>{title}</h1> : <h2>{title}</h2>}
          {subtitle ? <p className="muted page-hero__sub">{subtitle}</p> : null}
        </div>
      </div>
      {(actions || trailing) && (
        <div className="page-hero__aside">
          {actions}
          {trailing}
        </div>
      )}
    </header>
  );
}
