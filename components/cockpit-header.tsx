import { CockpitFrame } from '@/components/cockpit-frame'
import { SignOutButton } from '@/components/sign-out-button'
import { PortfolioSwitcher } from '@/components/portfolio-switcher'
import { getScopeContext } from '@/app/actions/portfolios'

/** Account and portfolio ownership stay on the existing server read path. */
export async function CockpitHeader({ userLabel }: { userLabel?: string | null }) {
  const { portfolios, scope, moneyIssue } = await getScopeContext()
  return <CockpitFrame moneyIssue={moneyIssue} account={<>
    <PortfolioSwitcher portfolios={portfolios} scope={scope} />
    {userLabel && <span className="cockpit-user" title={userLabel}>{userLabel}</span>}
    <SignOutButton />
  </>} />
}
