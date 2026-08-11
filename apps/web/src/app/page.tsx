const foundations = [
  "Multi-tenant SaaS boundary",
  "UI-independent Queue Engine",
  "PostgreSQL and Redis infrastructure",
  "JWT authentication foundation"
];

export default function Home() {
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="border-l-4 border-teal pl-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-teal">
            Phase 0 Foundation
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">
            Smart Queue Management System
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">
            A production SaaS foundation for queue operations across healthcare,
            public service, finance, and field-service environments.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {foundations.map((item) => (
            <div
              className="rounded-md border border-slate-200 bg-white p-5 shadow-sm"
              key={item}
            >
              <p className="text-sm font-medium text-slate-900">{item}</p>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-amber/30 bg-white p-5">
          <p className="text-sm leading-6 text-slate-700">
            Queue workflows, displays, printer bridge, analytics, and billing
            are intentionally deferred until the foundation is verified.
          </p>
        </div>
      </section>
    </main>
  );
}
