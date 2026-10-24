param([uint32]$PaneProcessId, [uint32]$ServerProcessId, [long]$ServerCreation)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$row = [ordered]@{ schema = 'aiterm.test-console-input.v1'; identity_matches = $false }
try {
  $server = Get-Process -Id $ServerProcessId
  $pane = Get-Process -Id $PaneProcessId
  $paneCreation = $pane.StartTime.ToUniversalTime().ToFileTimeUtc()
  $parent = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $PaneProcessId)
  $row.identity_matches = ($server.StartTime.ToUniversalTime().ToFileTimeUtc() -eq $ServerCreation) -and ($parent.ParentProcessId -eq $ServerProcessId)
  if (-not $row.identity_matches) { throw 'FixtureIdentityMismatch' }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FixtureConsoleInputObservation {
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetConsoleMode(IntPtr input, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNumberOfConsoleInputEvents(IntPtr input, out uint count);
  [StructLayout(LayoutKind.Explicit, Size=20)] public struct InputRecord {
    [FieldOffset(0)] public ushort kind;
    [FieldOffset(4)] public int down;
    [FieldOffset(8)] public ushort repeat;
    [FieldOffset(14)] public ushort character;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool PeekConsoleInputW(IntPtr input, [Out] InputRecord[] records, uint length, out uint read);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetConsoleProcessList([Out] uint[] processes, uint length);
  public static Dictionary<string,object> Observe(uint pid) {
    var row = new Dictionary<string,object>();
    IntPtr input = new IntPtr(-1);
    FreeConsole();
    bool attached = AttachConsole(pid);
    row["attached"] = attached;
    if (!attached) { row["attach_error"] = Marshal.GetLastWin32Error(); return row; }
    try {
      input = CreateFileW("CONIN$", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (input == new IntPtr(-1)) { row["input_open_error"] = Marshal.GetLastWin32Error(); return row; }
      uint mode, count;
      if (GetConsoleMode(input, out mode)) row["input_mode"] = mode;
      else row["mode_error"] = Marshal.GetLastWin32Error();
      if (GetNumberOfConsoleInputEvents(input, out count)) row["pending_input_events"] = count;
      else row["count_error"] = Marshal.GetLastWin32Error();
      var records = new InputRecord[4096];
      uint read;
      if (PeekConsoleInputW(input, records, 4096, out read)) {
        int text=0, enters=0, controls=0;
        for (int i=0; i<4096 && (uint)i<read; i++) {
          var r = records[i];
          if (r.kind != 1 || r.down == 0) continue;
          if (r.character >= 32 && r.character != 127) text += r.repeat;
          else if (r.character == 13) enters += r.repeat;
          else if (r.character != 0) controls += r.repeat;
        }
        row["peeked_events"] = read;
        row["queued_text_units"] = text;
        row["queued_enters"] = enters;
        row["queued_controls"] = controls;
      } else row["peek_error"] = Marshal.GetLastWin32Error();
      var processes = new uint[64];
      uint size = GetConsoleProcessList(processes, 64);
      row["console_process_count"] = size;
      bool contains = false;
      for (int i=0; i<64 && (uint)i<size; i++) if (processes[i] == pid) contains = true;
      row["console_contains_target"] = contains;
      return row;
    } finally {
      if (input != new IntPtr(-1)) CloseHandle(input);
      FreeConsole();
    }
  }
}
'@
  $row.console = [FixtureConsoleInputObservation]::Observe($PaneProcessId)
  $row.target_creation_unchanged = (Get-Process -Id $PaneProcessId).StartTime.ToUniversalTime().ToFileTimeUtc() -eq $paneCreation
  $row.server_creation_unchanged = (Get-Process -Id $ServerProcessId).StartTime.ToUniversalTime().ToFileTimeUtc() -eq $ServerCreation
} catch { $row.error_type = $_.Exception.GetType().Name }
$row | ConvertTo-Json -Compress -Depth 5
