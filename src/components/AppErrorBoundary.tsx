import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearActiveProjectId, exportActiveProject, recordDiagnostic } from '../lib/storageUtils';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  declare readonly props: Readonly<Props>;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void recordDiagnostic('react-render', error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="min-h-screen bg-background text-foreground p-6 flex items-center justify-center">
      <section className="w-full max-w-xl rounded-xl border border-red-500/40 bg-card p-6 space-y-4">
        <h1 className="text-xl font-bold">The project view crashed, but your saved checkpoints are still available.</h1>
        <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground" onClick={()=>window.location.reload()}>RELOAD LAST SAVED STATE</button>
          <button className="rounded-md border px-4 py-2" onClick={()=>void exportActiveProject().catch(error=>window.alert(error instanceof Error?error.message:'Export failed.'))}>EXPORT RECOVERY JSON</button>
          <button className="rounded-md border px-4 py-2" onClick={()=>{clearActiveProjectId();window.location.reload();}}>OPEN A SAFE NEW DRAFT</button>
        </div>
      </section>
    </main>;
  }
}
