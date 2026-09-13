import { windowsNativeProcessSource } from "./windows-codex-native.js";

// POSIXのexecに対応するWindows adapter。公式CLIを起動元の直接の子、中継を公式CLIの子として起動する。
export function windowsLauncherSource(node: string, relay: string, binary: string, root: string): string {
  const literal = (value: string) => JSON.stringify(value);
  return `using System;
using System.Diagnostics;
using System.Text;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
${windowsNativeProcessSource}
[DataContract] public sealed class LaunchPlan {
  [DataMember] public string directory;
  [DataMember] public string endpoint;
  [DataMember] public string[] arguments;
}
public static class AitermLauncher {
  static LaunchPlan Prepare(string[] args) {
    var arguments=new StringBuilder();
    foreach(var value in new string[] { ${[relay, "--prepare", root].map(literal).join(", ")} }) arguments.Append(AitermNativeProcess.Quote(value)).Append(' ');
    foreach(var value in args) arguments.Append(AitermNativeProcess.Quote(value)).Append(' ');
    var start=new ProcessStartInfo(${literal(node)},arguments.ToString());
    start.UseShellExecute=false; start.CreateNoWindow=true;
    start.RedirectStandardInput=true; start.RedirectStandardOutput=true; start.RedirectStandardError=true;
    start.StandardOutputEncoding=new UTF8Encoding(false);
    using(var child=Process.Start(start)) {
      child.StandardInput.Close();
      var output=child.StandardOutput.ReadToEndAsync();
      var error=child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
      child.WaitForExit(); System.Threading.Tasks.Task.WaitAll(output,error);
      if(child.ExitCode!=0) throw new InvalidOperationException("中継の起動準備に失敗しました");
      using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(output.Result)))
        return (LaunchPlan)new DataContractJsonSerializer(typeof(LaunchPlan)).ReadObject(stream);
    }
  }
  public static int Main(string[] args) {
    LaunchPlan plan=null;
    try {
      Console.OutputEncoding=new UTF8Encoding(false);
      plan=Prepare(args);
      using(var lifetime=new AitermNativeProcess.Lifetime())
      using(var server=AitermNativeProcess.Start(AitermNativeProcess.ParentId(),${literal(binary)},plan.arguments,plan.directory!=null,lifetime)) {
        if(plan.directory==null) return server.Wait();
        // 中継は公式CLIのjobを継承する。launcherは終了監視だけを担い、JSON-RPCを通さない。
        using(var bridge=AitermNativeProcess.Start(server.Pid,${literal(node)},new string[] {
          ${literal(relay)},"--serve",${literal(binary)},plan.directory,plan.endpoint,server.Pid.ToString()
        },false,null)) {
          int code=bridge.Wait();
          lifetime.Dispose();
          server.Wait();
          return code;
        }
      }
    } catch(Exception error) { Console.Error.WriteLine("aiterm-mcp: Windows起動失敗: "+error.Message); return 1; }
    finally { if(plan!=null && plan.directory!=null && Directory.Exists(plan.directory)) Directory.Delete(plan.directory,true); }
  }
}
`;
}
