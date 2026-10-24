process.env.AITERM_DIAGNOSTIC_MARKER_ONLY = '1';
process.env.AITERM_DIAGNOSTIC_CAPTURE_MISSING = '1';
await import('./windows-startup-trace.mjs');
