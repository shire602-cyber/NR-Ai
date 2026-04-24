import { Activity } from 'lucide-react';

export default function FirmHealth() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Health Dashboard</h1>
          <p className="text-sm text-muted-foreground">Client portfolio health monitoring</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Client health metrics coming soon.
      </div>
    </div>
  );
}
