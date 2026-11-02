import {auth} from '@/lib/auth'
import {recordAppActivity,backgroundActivityStatus} from '@/lib/background-activity'
import {NextRequest,NextResponse} from 'next/server'
export async function POST(req:NextRequest){
 if(req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Nicht erlaubt.'},{status:403})
 const origin=req.headers.get('origin');const host=req.headers.get('host')??req.nextUrl.host;let sameOrigin=true;if(origin){try{const parsed=new URL(origin);sameOrigin=['http:','https:'].includes(parsed.protocol)&&parsed.host===host}catch{sameOrigin=false}}if(!sameOrigin)return NextResponse.json({error:'Nicht erlaubt.'},{status:403})
 const session=await auth.api.getSession({headers:req.headers});if(!session?.user)return NextResponse.json({error:'Anmeldung erforderlich.'},{status:401})
 await recordAppActivity();return NextResponse.json(await backgroundActivityStatus(),{headers:{'Cache-Control':'no-store'}})
}
