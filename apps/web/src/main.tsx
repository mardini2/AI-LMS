// goal: mount the React app with TanStack Query defaults and global styles.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios from 'axios'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // avoid hammering the API on auth/validation failures
      retry: (failureCount, error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status
          if (typeof status === 'number' && status >= 400 && status < 500) {
            return false
          }
        }
        return failureCount < 2
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
