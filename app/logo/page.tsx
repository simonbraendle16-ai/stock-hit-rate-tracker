import { logoDrafts } from '@/components/logo-drafts'

export const metadata = {
  title: 'Logo-Entwürfe · Trading Cockpit',
  description: 'Entwurfsvarianten für das App-Icon des Trading Cockpits.',
}

export default function LogoDraftsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Branding · Entwurf
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
          Logo-Entwürfe
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Sechs Varianten als App-Icon auf Kachel, jeweils in Primärfarbe, invertiert
          und als Header-Lockup. Sag mir welcher Buchstabe dir zusagt, dann setze ich
          ihn als Logo, Favicon und Header-Zeichen um.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {logoDrafts.map(({ id, name, note, Mark }) => (
          <section
            key={id}
            className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-sm font-semibold tracking-tight text-card-foreground">
                {name}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {id}
              </span>
            </div>

            {/* Kachel-Varianten */}
            <div className="flex items-end gap-4">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Mark className="size-9" />
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Mark className="size-6" />
              </div>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Mark className="size-[18px]" />
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-secondary text-primary">
                <Mark className="size-6" />
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
                <Mark className="size-6" />
              </div>
            </div>

            {/* Header-Lockup */}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Mark className="size-5" />
              </div>
              <div>
                <p className="font-heading text-sm font-semibold leading-tight tracking-tight text-foreground">
                  Trading Cockpit
                </p>
                <p className="font-mono text-[10px] leading-tight text-muted-foreground">
                  Disziplin · Elliott · Trefferquote
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
          </section>
        ))}
      </div>
    </main>
  )
}
