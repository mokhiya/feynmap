import { LANGS, useLang } from '../i18n';

export default function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div className={'inline-flex rounded-lg border border-slate-200 bg-white overflow-hidden ' + (compact ? 'text-xs' : 'text-sm')}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          className={
            'px-2.5 py-1 transition ' +
            (l.code === lang
              ? 'bg-accent text-white'
              : 'text-slate-600 hover:bg-slate-100')
          }
          title={l.native}
        >
          {compact ? l.code.toUpperCase() : `${l.flag} ${l.native}`}
        </button>
      ))}
    </div>
  );
}
