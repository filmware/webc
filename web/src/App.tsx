import { useMemo } from 'react'

import css from './App.module.scss'

function AppContent() {
  const className = useMemo(() => {
    const classes = [css.base]
    return classes.join(' ')
  }, [])

  return <div className={className}>App</div>
}

function App() {
  return <AppContent />
}

export default App
