// Windowsの標準process作成APIで、公式CLIの直接の親と必要なstdioだけを引き継ぐ。
// launcherと公式CLIのPIDは異なる。Macのexecと同じPIDだとは扱わない。
export const windowsNativeProcessSource = String.raw`
public static class AitermNativeProcess {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public int cb; public string reserved,desktop,title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reservedSize;
    public IntPtr reservedBytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
    public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string executable;
  }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint activeProcesses; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct JobInfo {
    public JobLimits limits; public ulong reads,writes,others,readBytes,writeBytes,otherBytes;
    public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfoEx startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,IntPtr name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref JobInfo info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint time);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exitCode);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static int ParentId() {
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0); Check(snapshot!=new IntPtr(-1));
    try {
      var entry=new ProcessEntry(); entry.size=(uint)Marshal.SizeOf(entry);
      Check(Process32FirstW(snapshot,ref entry)); int current=Process.GetCurrentProcess().Id;
      do { if(entry.pid==current) return (int)entry.parent; } while(Process32NextW(snapshot,ref entry));
      throw new InvalidOperationException("launcherの親processが見つかりません");
    } finally { CloseHandle(snapshot); }
  }
  public static string Quote(string text) {
    if(text.Length>0 && text.IndexOfAny(new char[] {' ','\t','\n','\v','"'})<0) return text;
    var result=new StringBuilder().Append('"'); int slashes=0;
    foreach(char c in text) {
      if(c=='\\') { slashes++; continue; }
      if(c=='"') { result.Append('\\',slashes*2+1); result.Append(c); }
      else { result.Append('\\',slashes); result.Append(c); }
      slashes=0;
    }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  public sealed class Child : IDisposable {
    internal IntPtr handle; public readonly int Pid;
    internal Child(IntPtr process,int pid) { handle=process; Pid=pid; }
    public int Wait() { WaitForSingleObject(handle,0xffffffff); uint code; Check(GetExitCodeProcess(handle,out code)); return (int)code; }
    public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
  }
  public sealed class Lifetime : IDisposable {
    internal IntPtr handle;
    public Lifetime() {
      handle=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero); Check(handle!=IntPtr.Zero);
      var info=new JobInfo(); info.limits.flags=0x2000;
      try { Check(SetInformationJobObject(handle,9,ref info,(uint)Marshal.SizeOf(info))); }
      catch { Dispose(); throw; }
    }
    public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
  }
  public static Child Start(int parentId,string binary,string[] args,bool quiet,Lifetime lifetime) {
    IntPtr parent=IntPtr.Zero,list=IntPtr.Zero,parentValue=IntPtr.Zero,handleList=IntPtr.Zero,nul=IntPtr.Zero;
    var remote=new IntPtr[3]; var info=new ProcessInfo(); bool initialized=false;
    try {
      parent=OpenProcess(0x80|0x40,false,parentId); Check(parent!=IntPtr.Zero);
      var current=GetCurrentProcess();
      if(quiet) { nul=CreateFileW("NUL",0xc0000000,3,IntPtr.Zero,3,0,IntPtr.Zero); Check(nul!=new IntPtr(-1)); }
      // 指定した親へ必要な3 handleだけを一時複製し、child作成直後に親から閉じる。
      for(int i=0;i<3;i++) Check(DuplicateHandle(current,quiet && i<2 ? nul : GetStdHandle(-10-i),parent,out remote[i],0,true,2));
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
      list=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list,2,0,ref size)); initialized=true;
      parentValue=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(parentValue,parent);
      Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x20000,parentValue,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero));
      handleList=Marshal.AllocHGlobal(3*IntPtr.Size);
      for(int i=0;i<3;i++) Marshal.WriteIntPtr(handleList,i*IntPtr.Size,remote[i]);
      Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x20002,handleList,(IntPtr)(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      var startup=new StartupInfoEx(); startup.startup.cb=Marshal.SizeOf(startup); startup.attributes=list;
      startup.startup.flags=0x100; startup.startup.input=remote[0]; startup.startup.output=remote[1]; startup.startup.error=remote[2];
      var command=new StringBuilder(Quote(binary)); foreach(var arg in args) command.Append(' ').Append(Quote(arg));
      Check(CreateProcessW(binary,command,IntPtr.Zero,IntPtr.Zero,true,0x80000|0x8000000|4,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out info));
      if(lifetime!=null) Check(AssignProcessToJobObject(lifetime.handle,info.process));
      for(int i=0;i<3;i++) { IntPtr local; Check(DuplicateHandle(parent,remote[i],current,out local,0,false,3)); CloseHandle(local); remote[i]=IntPtr.Zero; }
      Check(ResumeThread(info.thread)!=0xffffffff);
      var child=new Child(info.process,info.pid); info.process=IntPtr.Zero; return child;
    } catch {
      if(info.process!=IntPtr.Zero) TerminateProcess(info.process,1);
      throw;
    } finally {
      if(nul!=IntPtr.Zero && nul!=new IntPtr(-1)) CloseHandle(nul);
      if(info.thread!=IntPtr.Zero) CloseHandle(info.thread); if(info.process!=IntPtr.Zero) CloseHandle(info.process);
      foreach(var handle in remote) if(handle!=IntPtr.Zero) { IntPtr local; if(DuplicateHandle(parent,handle,GetCurrentProcess(),out local,0,false,3)) CloseHandle(local); }
      if(initialized) DeleteProcThreadAttributeList(list);
      if(list!=IntPtr.Zero) Marshal.FreeHGlobal(list); if(parentValue!=IntPtr.Zero) Marshal.FreeHGlobal(parentValue); if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if(parent!=IntPtr.Zero) CloseHandle(parent);
    }
  }
}
`;
