import { createBrowserRouter } from 'react-router-dom'

class AppRoutes {
  #router: ReturnType<typeof createBrowserRouter> | undefined

  init(app: React.ReactNode) {
    // match everything with "*"
    this.#router = createBrowserRouter([{ element: app, path: '*' }])
    return this.#router
  }

  get() {
    if (!this.#router)
      throw new Error('Router called before instantiation -- call AppRoutes.init first')
    return this.#router
  }
}

export default new AppRoutes()
