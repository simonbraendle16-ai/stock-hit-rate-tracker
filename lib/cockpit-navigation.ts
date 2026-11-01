/** Existing detail routes belong to their parent workspace. */
export function workspaceIsActive(pathname:string,href:string){
  const target=href.split(/[?#]/)[0]
  if(target==='/')return pathname==='/'
  if(target==='/watchlist'&&pathname.startsWith('/stock/'))return true
  if(target==='/trades'&&pathname==='/broker-orders')return true
  return pathname===target||pathname.startsWith(target+'/')
}
