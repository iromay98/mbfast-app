import { Badge } from "@/components/ui";
import {
  requestStatusLabels,
  requestStatusColors,
  formatDateTime,
} from "@/lib/labels";

type Event = {
  id: string;
  status: keyof typeof requestStatusLabels;
  comment: string | null;
  createdAt: Date;
  actor?: { name: string } | null;
};

export function RequestTimeline({ events }: { events: Event[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="mt-1 flex flex-col items-center">
            <span className="h-2.5 w-2.5 rounded-full bg-gold-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge color={requestStatusColors[e.status]}>
                {requestStatusLabels[e.status]}
              </Badge>
              <span className="text-xs text-ink-soft">
                {formatDateTime(e.createdAt)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-ink-soft">
              {e.actor?.name ?? "—"}
              {e.comment ? `・${e.comment}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
