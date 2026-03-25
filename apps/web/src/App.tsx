// goal: top-level router shell for the whole LMS UI.

import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './routes/app-router'

function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}

export default App
