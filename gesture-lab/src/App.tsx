
import CameraManager from './components/CameraManager'

function App() {
  return (
    <main style={{
      width: 'min(900px, 92vw)',
      margin: '0 auto',
      padding: '40px 0',
      textAlign: 'center'
    }}>
      <p style={{
        color: '#38bdf8',
        letterSpacing: 4,
        fontWeight: 700
      }}>
        GESTURE LAB
      </p>

      <h1>Visual Gesture Control</h1>

      <p style={{ color: '#94a3b8', marginBottom: 32 }}>
        Phase 01 — Camera Integration
      </p>

      <CameraManager />
    </main>
  )
}

export default App
