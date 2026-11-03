// Shared private marker decoder. A v2 cursor is the original Aiterm
// before_send reference, never native input acceptance or a completion fence.
export type ClaudeOperationMarker = { operationId: string | null; eventCursor: number | null;
  inputId?: string;
  transcript?: { session_id: string; cursor: number; device: string | null; inode: string | null } | null };
export function parseClaudeOperationMarker(value: unknown): ClaudeOperationMarker {
  const row = value as Record<string, unknown>;
  const keys = row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row).sort().join(",") : "";
  const legacy = keys === "operation_id,schema" && row.schema === "aiterm.claude-operation-marker.v1";
  const bound = keys === "event_cursor,operation_id,schema" && row.schema === "aiterm.claude-operation-marker.v2"
    && Number.isSafeInteger(row.event_cursor) && (row.event_cursor as number) >= 0;
  const captured = keys === "event_cursor,input_id,operation_id,schema,transcript" && row.schema === "aiterm.claude-operation-marker.v3"
    && Number.isSafeInteger(row.event_cursor) && (row.event_cursor as number) >= 0
    && typeof row.input_id === "string" && /^[a-f0-9]{32}$/.test(row.input_id);
  if (captured && row.transcript !== null) {
    const value = row.transcript as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "cursor,device,inode,session_id"
      || typeof value.session_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.session_id)
      || !Number.isSafeInteger(value.cursor) || (value.cursor as number) < 0
      || ![value.device, value.inode].every(n => n === null || (typeof n === "string" && /^\d{1,30}$/.test(n)))
      || ((value.device === null) !== (value.inode === null)) || (value.device === null && value.cursor !== 0))
      throw new Error("Claude transcript boundaryが不正です");
  }
  if ((!legacy && !bound && !captured) || (row.operation_id !== null
    && (typeof row.operation_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.operation_id))))
    throw new Error("Claude operation markerが不正です");
  return { operationId: row.operation_id as string | null, eventCursor: bound || captured ? row.event_cursor as number : null,
    ...(captured ? { inputId: row.input_id as string, transcript: row.transcript as ClaudeOperationMarker["transcript"] } : {}) };
}
