'use client'
import {useEffect,useState} from 'react'
export function AppActivity(){
 const [limited,setLimited]=useState(false)
 useEffect(()=>{let stopped=false,last=0;const tick=async()=>{if(document.visibilityState!=='visible'||Date.now()-last<60000)return;last=Date.now();try{const r=await fetch('/api/activity',{method:'POST'});if(r.ok){const s=await r.json();if(!stopped)setLimited(s.enabled===true)}}catch{}};void tick();const timer=setInterval(()=>void tick(),60000);const visible=()=>void tick();document.addEventListener('visibilitychange',visible);return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[])
 return limited?<p className="px-4 py-1 text-xs text-muted-foreground">Ohne sichtbare App laufen automatische Aktualisierungen, Alarme und Demoabläufe im 15-Minuten-Takt. Beim Öffnen wird der aktive Modus wiederhergestellt.</p>:null
}
