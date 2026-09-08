type Props = {
  /** sidebar = dark console; topbar = student/teacher light; splash = loading */
  variant?: 'sidebar' | 'topbar' | 'splash' | 'compact';
  title?: string;
  subtitle?: string;
  className?: string;
};

/**
 * Shared DIU + Department of English lockup used across portals
 * so the product reads as an official English-dept SmartRoutine.
 */
export function BrandMark({
  variant = 'sidebar',
  title,
  subtitle,
  className = '',
}: Props) {
  const isSplash = variant === 'splash';
  /** Uni wordmark only on splash — sidebar/topbar stay crest-first and compact */
  const showUni = isSplash;
  const showMotto = isSplash;

  return (
    <div className={`brand-mark brand-mark--${variant} ${className}`.trim()}>
      <div className="brand-mark__crests" aria-hidden={false}>
        {showUni && (
          <img
            className="brand-mark__diu"
            src="/branding/diu-university-logo.png"
            alt=""
          />
        )}
        <img
          className="brand-mark__eng"
          src="/branding/diu-english-dept-logo.png?v=4"
          alt="Department of English"
        />
      </div>
      <div className="brand-mark__copy">
        <span className="brand-mark__kicker">
          {variant === 'sidebar' ? 'DIU · English' : 'DIU · Department of English'}
        </span>
        <strong className="brand-mark__title">{title || 'SmartRoutine'}</strong>
        {subtitle ? <p className="brand-mark__sub">{subtitle}</p> : null}
        {showMotto ? <p className="brand-mark__motto">Sapere Aude</p> : null}
      </div>
    </div>
  );
}
