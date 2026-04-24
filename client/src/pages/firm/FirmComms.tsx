import { MessageSquare } from 'lucide-react';

export default function FirmComms() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MessageSquare className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Communications</h1>
          <p className="text-sm text-muted-foreground">Client communications hub</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Communications hub coming soon. WhatsApp inbox will be accessible here.
      </div>
    </div>
  );
}
