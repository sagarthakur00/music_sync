import type { RoomHook } from "../sync/useRoom";

type Props = { sync: RoomHook["sync"] };

export default function SyncBadge({ sync }: Props) {
  const tip = `Offset ${Math.round(sync.offsetMs)} ms · round trip ${Math.round(sync.rttMs)} ms · ${sync.samples} samples`;
  return (
    <span className={`sync-badge ${sync.synced ? "is-synced" : "is-syncing"}`} title={tip} role="status">
      <span className="sync-dot" aria-hidden="true" />
      {sync.synced ? "Synced" : "Syncing…"}
    </span>
  );
}
