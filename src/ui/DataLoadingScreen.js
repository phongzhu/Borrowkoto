import './DataLoadingScreen.css';

export default function DataLoadingScreen({
  label = 'Loading data',
  message = 'Fetching the latest information from the database.',
  compact = false,
  fullScreen = false,
  title = 'Getting things ready',
}) {
  return (
    <section aria-label={label} aria-live="polite" className={`data-loading-screen${compact ? ' is-compact' : ''}${fullScreen ? ' is-fullscreen' : ''}`} role="status">
      <div aria-hidden="true" className="data-loading-art">
        <span className="data-loading-orbit" />
        <span className="data-loading-spark data-loading-spark-one" />
        <span className="data-loading-spark data-loading-spark-two" />
        <svg className="data-loading-package" viewBox="0 0 92 92">
          <path d="M12 28 46 10l34 18-34 18Z" />
          <path d="M12 28v39l34 17V46M80 28v39L46 84" />
          <path d="m29 19 34 18v18" />
          <path className="data-loading-tape" d="m39 14 14 7v8l-14-7ZM39 22v8l7 4v-8M39 43v28l7 4V47" />
          <path className="data-loading-label" d="m56 48 13-7v12l-13 7zM59 49l7-4M59 53l7-4" />
        </svg>
      </div>
      <div className="data-loading-copy">
        <strong>{title}</strong>
        <span>{message}</span>
        <i aria-hidden="true"><b /><b /><b /></i>
      </div>
    </section>
  );
}
