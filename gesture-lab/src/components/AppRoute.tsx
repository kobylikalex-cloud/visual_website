import {lazy,Suspense} from 'react'
import App from '../App'
const SpatialLab=lazy(()=>import('./SpatialLab.tsx'))
export default function AppRoute(){
  return window.location.pathname==='/spatial-lab'
    ?<Suspense fallback={<p>Loading the local spatial lab…</p>}><SpatialLab/></Suspense>
    :<App/>
}
