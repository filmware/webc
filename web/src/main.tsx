import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import App from '@/App'
import appRoutes from '@/routes/appRoutes'

import './index.scss'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={appRoutes.init(<App />)} />
  </React.StrictMode>,
)
