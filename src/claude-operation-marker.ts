// Shared private marker decoder. A v2 cursor is the original Aiterm
// before_send reference, never native input acceptance or a completion fence.
export type ClaudeOperationMarker = { operationId: string | null; eventCursor: number | null };
export function parseClaudeOperationMarker(value: unknown): ClaudeOperationMarker {
  const row = value as Record<string, unknown>;
  const keys = row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row).sort().join(",") : "";
  const legacy = keys === "operation_id,schema" && row.schema === "aiterm.claude-operation-marker.v1";
  const bound = keys === "event_cursor,operation_id,schema" && row.schema === "aiterm.claude-operation-marker.v2"
    && Number.isSafeInteger(row.event_cursor) && (row.event_cursor as number) >= 0;
  if ((!legacy && !bound) || (row.operation_id !== null
    && (typeof row.operation_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.operation_id))))
    throw new Error("Claude operation markerが不正です");
  return { operationId: row.operation_id as string | null, eventCursor: bound ? row.event_cursor as number : null };
}
