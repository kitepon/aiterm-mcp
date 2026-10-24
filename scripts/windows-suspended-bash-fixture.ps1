param([string]$Bash, [string]$Ready, [string]$Release)
$ErrorActionPreference = 'Stop'
trap { [IO.File]::WriteAllText($Ready + '.error', $_.ToString()); exit 1 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class IsolatedBashStart {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Startup {
    public uint cb; public string reserved; public string desktop; public string title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedSize;
    public IntPtr reservedBytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct Process { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup si, out Process pi);
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$si = [IsolatedBashStart+Startup]::new()
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][IsolatedBashStart+Startup])
$si.flags = 0x100
$si.input = [IsolatedBashStart]::GetStdHandle(-10)
$si.output = [IsolatedBashStart]::GetStdHandle(-11)
$si.error = [IsolatedBashStart]::GetStdHandle(-12)
$pi = [IsolatedBashStart+Process]::new()
$Bash = [IO.Path]::GetFullPath($Bash.Replace('/', '\'))
if (-not [IO.File]::Exists($Bash)) { throw 'fixture Bash path does not exist' }
$line = [Text.StringBuilder]::new(('"' + $Bash + '" --noprofile --norc -i'))
if (-not [IsolatedBashStart]::CreateProcess($Bash,$line,[IntPtr]::Zero,[IntPtr]::Zero,$true,4,[IntPtr]::Zero,$null,[ref]$si,[ref]$pi)) {
  throw ('fixture CreateProcess error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
$resumed = $false
try {
  [IO.File]::WriteAllText($Ready,[string]$pi.pid)
  while (-not [IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 20 }
  [void][IsolatedBashStart]::ResumeThread($pi.thread)
  $resumed = $true
  [void][IsolatedBashStart]::WaitForSingleObject($pi.process,[uint32]::MaxValue)
} finally {
  if (-not $resumed) { [void][IsolatedBashStart]::ResumeThread($pi.thread) }
  [void][IsolatedBashStart]::CloseHandle($pi.thread)
  [void][IsolatedBashStart]::CloseHandle($pi.process)
}
