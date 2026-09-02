import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$lang/home')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/$lang/home"!</div>
}
