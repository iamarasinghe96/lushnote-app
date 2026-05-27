import Link from 'next/link'

export default function AccountDeletedPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-md text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/icon.svg" alt="LushNote" width={40} height={40} />
          <span className="text-xl font-bold text-[#0f172a]">LushNote</span>
        </div>

        <h1 className="text-2xl font-bold text-[#0f172a] mb-2">
          Your account has been deleted
        </h1>
        <p className="text-[#475569] mb-8">
          Everything associated with your account has been permanently erased
        </p>

        <ul className="text-left space-y-3 mb-8">
          {[
            'All progress notes deleted',
            'All patient profiles deleted',
            'Your personal information removed',
            'Account access revoked',
          ].map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="flex-none w-5 h-5 rounded-full bg-[#d1fae5] flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="text-[#0f172a] text-sm">{item}</span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-[#475569] mb-6">
          If you ever need a clinical note tool in the future, you&apos;re always welcome back.
        </p>

        <Link
          href="/"
          className="inline-block rounded-xl bg-[#2563eb] px-6 py-3 text-sm font-medium text-white transition active:scale-95"
        >
          Back to LushNote
        </Link>
      </div>
    </main>
  )
}
