# 0135: Match Darwin native registrations using kernel microseconds

Grok1.0.70 on macOS registers pid_start as the Unix process birth in microseconds. An isolated original TUI registration matched Apple's proc_pidinfo BSD info exactly. The portable ps lstart string has only seconds and cannot substitute for that identity.

Use pinned Koffi3.3.4 to call the read-only system API on Darwin. Validate the complete buffer and PID, and reject invalid/unsafe birth values. Keep the Linux registry adapter unchanged, and do not infer a Windows format. The initial Mac backend accepts only fresh no-goal readback; existing Goal records and all mutations remain unavailable until separately accepted. Multiple conversations registered under the same PID are ambiguous and never resolved by order or recency.

npm chooses platform optional native dependencies for the installing host. MCPB is built once for both Mac architectures, so its build verifies each Darwin native archive against the normal lock integrity and bundles both. No compiler or Python runtime is added to the product requirements. FFI failure does not start a replacement worker or choose a different session.
