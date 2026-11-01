import {auth} from '@/lib/auth'
import {headers} from 'next/headers'
import {redirect} from 'next/navigation'
import {CockpitHeader} from '@/components/cockpit-header'
import {FibonacciPanel} from '@/components/fibonacci-panel'
import {getFibonacciData} from '@/app/actions/fibonacci'
export default async function CollectionPage(){
  const session=await auth.api.getSession({headers:await headers()});if(!session?.user)redirect('/sign-in')
  const data=await getFibonacciData()
  return <div className="min-h-svh"><CockpitHeader userLabel={session.user.name||session.user.email}/><main id="cockpit-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><h1 className="mb-2 text-2xl font-semibold">Datensammlung</h1><p className="mb-4 text-sm text-muted-foreground">Beobachtungen erfassen und korrigieren. Derselbe Bestand wird in der Wellenstatistik ausgewertet.</p><FibonacciPanel {...data} workspace="collection"/></main></div>
}
