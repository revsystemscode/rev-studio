import { useEffect, useState } from 'react'
import { connectCore } from './connect'

export function App() {
  const [connections, setConnections] = useState(0)
  const [projects, setProjects] = useState<number | null>(null)

  useEffect(
    () =>
      connectCore((client) => {
        setConnections((n) => n + 1)
        void client.call('projects.list', {}).then((list) => setProjects(list.length))
      }),
    [],
  )

  return (
    <main>
      <h1>Rev Studio</h1>
      <p data-testid="core-status">{projects === null ? 'conectando' : 'conectado'}</p>
      <p data-testid="core-connections">{connections}</p>
      <p>{projects ?? 0} proyectos</p>
    </main>
  )
}
