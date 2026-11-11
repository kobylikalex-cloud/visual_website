/** Return the next 60 Hz deadline, or null when this display tick is too early. */
export function nextSpatialRenderTime(now:number,deadline:number):number|null {
  // RAF clocks are quantized; allow a quarter millisecond at a deadline rather
  // than accidentally skipping an entire display refresh. Preserve the phase.
  const interval=1000/60,epsilon=.25
  if(!Number.isFinite(now)||now+epsilon<deadline)return null
  if(!Number.isFinite(deadline))return now+interval
  return deadline+Math.max(1,Math.floor((now-deadline+epsilon)/interval)+1)*interval
}
