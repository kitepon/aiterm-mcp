---
title: "Node.js process.execPath"
source_url: "https://nodejs.org/api/process.html"
source_type: docs
fetched: 2026-09-19
topic: installation
tags: ["node", "symlink", "setup"]
summary: "process.execPathはNode実行ファイルの絶対パスを返し、symlinkを解決する。"
relevance: "HomebrewのCellar実体を永続する起動設定へ固定してはいけない根拠。"
chars: 179959
---

[Skip to content](#apicontent)

[Node.js](/ "Go back to the home page")

---

* [About this documentation](documentation.html)
* [Usage and example](synopsis.html)
* [Assertion testing](assert.html)
* [Asynchronous context tracking](async_context.html)
* [Async hooks](async_hooks.html)
* [Benchmark runner](bench.html)
* [Buffer](buffer.html)
* [C++ addons](addons.html)
* [C/C++ addons with Node-API](n-api.html)
* [C++ embedder API](embedding.html)
* [Child processes](child_process.html)
* [Cluster](cluster.html)
* [Command-line options](cli.html)
* [Console](console.html)
* [Crypto](crypto.html)
* [Debugger](debugger.html)
* [Deprecated APIs](deprecations.html)
* [Diagnostics Channel](diagnostics_channel.html)
* [DNS](dns.html)
* [Domain](domain.html)
* [Environment Variables](environment_variables.html)
* [Errors](errors.html)
* [Events](events.html)
* [File system](fs.html)
* [FFI](ffi.html)
* [Globals](globals.html)
* [HTTP](http.html)
* [HTTP/2](http2.html)
* [HTTPS](https.html)
* [Inspector](inspector.html)
* [Internationalization](intl.html)
* [Iterable Streams API](stream_iter.html)
* [Modules: CommonJS modules](modules.html)
* [Modules: ECMAScript modules](esm.html)
* [Modules: `node:module` API](module.html)
* [Modules: Packages](packages.html)
* [Modules: TypeScript](typescript.html)
* [Net](net.html)
* [OS](os.html)
* [Path](path.html)
* [Performance hooks](perf_hooks.html)
* [Permissions](permissions.html)
* [Process](process.html)
* [Punycode](punycode.html)
* [Query strings](querystring.html)
* [Readline](readline.html)
* [REPL](repl.html)
* [Report](report.html)
* [Single executable applications](single-executable-applications.html)
* [SQLite](sqlite.html)
* [Stream](stream.html)
* [String decoder](string_decoder.html)
* [Test runner](test.html)
* [Timers](timers.html)
* [TLS/SSL](tls.html)
* [Trace events](tracing.html)
* [TTY](tty.html)
* [UDP/datagram](dgram.html)
* [URL](url.html)
* [Utilities](util.html)
* [V8](v8.html)
* [Virtual File System](vfs.html)
* [VM](vm.html)
* [WASI](wasi.html)
* [Web Crypto API](webcrypto.html)
* [Web Streams API](webstreams.html)
* [Worker threads](worker_threads.html)
* [Zlib](zlib.html)

---

* [Code repository and issue tracker](https://github.com/nodejs/node)

# Node.js v26.9.0 documentation

* Node.js v26.9.0
* [Table of contents](#toc-picker)

  + [Process](process.html#process)
    - [Process events](process.html#process-events)
      * [Event: `'beforeExit'`](process.html#event-beforeexit)
      * [Event: `'disconnect'`](process.html#event-disconnect)
      * [Event: `'exit'`](process.html#event-exit)
      * [Event: `'message'`](process.html#event-message)
      * [Event: `'rejectionHandled'`](process.html#event-rejectionhandled)
      * [Event: `'workerMessage'`](process.html#event-workermessage)
      * [Event: `'uncaughtException'`](process.html#event-uncaughtexception)
        + [Warning: Using `'uncaughtException'` correctly](process.html#warning-using-uncaughtexception-correctly)
      * [Event: `'uncaughtExceptionMonitor'`](process.html#event-uncaughtexceptionmonitor)
      * [Event: `'unhandledRejection'`](process.html#event-unhandledrejection)
      * [Event: `'warning'`](process.html#event-warning)
        + [Emitting custom warnings](process.html#emitting-custom-warnings)
        + [Node.js warning names](process.html#nodejs-warning-names)
      * [Event: `'worker'`](process.html#event-worker)
      * [Signal events](process.html#signal-events)
    - [`process.abort()`](process.html#processabort)
    - [`process.addUncaughtExceptionCaptureCallback(fn)`](process.html#processadduncaughtexceptioncapturecallbackfn)
    - [`process.allowedNodeEnvironmentFlags`](process.html#processallowednodeenvironmentflags)
    - [`process.arch`](process.html#processarch)
    - [`process.argv`](process.html#processargv)
    - [`process.argv0`](process.html#processargv0)
    - [`process.availableMemory()`](process.html#processavailablememory)
    - [`process.channel`](process.html#processchannel)
      * [`process.channel.ref()`](process.html#processchannelref)
      * [`process.channel.unref()`](process.html#processchannelunref)
    - [`process.chdir(directory)`](process.html#processchdirdirectory)
    - [`process.config`](process.html#processconfig)
    - [`process.connected`](process.html#processconnected)
    - [`process.constrainedMemory()`](process.html#processconstrainedmemory)
    - [`process.cpuUsage([previousValue])`](process.html#processcpuusagepreviousvalue)
    - [`process.cwd()`](process.html#processcwd)
    - [`process.debugPort`](process.html#processdebugport)
    - [`process.disconnect()`](process.html#processdisconnect)
    - [`process.dlopen(module, filename[, flags])`](process.html#processdlopenmodule-filename-flags)
    - [`process.emitWarning(warning[, options])`](process.html#processemitwarningwarning-options)
    - [`process.emitWarning(warning[, type[, code]][, ctor])`](process.html#processemitwarningwarning-type-code-ctor)
      * [Avoiding duplicate warnings](process.html#avoiding-duplicate-warnings)
    - [`process.env`](process.html#processenv)
    - [`process.execArgv`](process.html#processexecargv)
    - [`process.execPath`](process.html#processexecpath)
    - [`process.execve(file[, args[, env]])`](process.html#processexecvefile-args-env)
    - [`process.exit([code])`](process.html#processexitcode)
    - [`process.exitCode`](process.html#processexitcode-1)
    - [`process.features.cached_builtins`](process.html#processfeaturescached_builtins)
    - [`process.features.debug`](process.html#processfeaturesdebug)
    - [`process.features.inspector`](process.html#processfeaturesinspector)
    - [`process.features.ipv6`](process.html#processfeaturesipv6)
    - [`process.features.require_module`](process.html#processfeaturesrequire_module)
    - [`process.features.tls`](process.html#processfeaturestls)
    - [`process.features.tls_alpn`](process.html#processfeaturestls_alpn)
    - [`process.features.tls_ocsp`](process.html#processfeaturestls_ocsp)
    - [`process.features.tls_sni`](process.html#processfeaturestls_sni)
    - [`process.features.typescript`](process.html#processfeaturestypescript)
    - [`process.features.uv`](process.html#processfeaturesuv)
    - [`process.finalization.register(ref, callback)`](process.html#processfinalizationregisterref-callback)
    - [`process.finalization.registerBeforeExit(ref, callback)`](process.html#processfinalizationregisterbeforeexitref-callback)
    - [`process.finalization.unregister(ref)`](process.html#processfinalizationunregisterref)
    - [`process.getActiveResourcesInfo()`](process.html#processgetactiveresourcesinfo)
    - [`process.getBuiltinModule(id)`](process.html#processgetbuiltinmoduleid)
    - [`process.getegid()`](process.html#processgetegid)
    - [`process.geteuid()`](process.html#processgeteuid)
    - [`process.getgid()`](process.html#processgetgid)
    - [`process.getgroups()`](process.html#processgetgroups)
    - [`process.getuid()`](process.html#processgetuid)
    - [`process.hasUncaughtExceptionCaptureCallback()`](process.html#processhasuncaughtexceptioncapturecallback)
    - [`process.hrtime([time])`](process.html#processhrtimetime)
    - [`process.hrtime.bigint()`](process.html#processhrtimebigint)
    - [`process.initgroups(user, extraGroup)`](process.html#processinitgroupsuser-extragroup)
    - [`process.kill(pid[, signal])`](process.html#processkillpid-signal)
    - [`process.loadEnvFile(path)`](process.html#processloadenvfilepath)
    - [`process.mainModule`](process.html#processmainmodule)
    - [`process.memoryUsage()`](process.html#processmemoryusage)
      * [A note on process memoryUsage](process.html#a-note-on-process-memoryusage)
    - [`process.memoryUsage.rss()`](process.html#processmemoryusagerss)
    - [`process.nextTick(callback[, ...args])`](process.html#processnexttickcallback-args)
      * [When to use `queueMicrotask()` vs. `process.nextTick()`](process.html#when-to-use-queuemicrotask-vs-processnexttick)
    - [`process.noDeprecation`](process.html#processnodeprecation)
    - [`process.permission`](process.html#processpermission)
      * [`process.permission.has(scope[, reference])`](process.html#processpermissionhasscope-reference)
      * [`process.permission.drop(scope[, reference])`](process.html#processpermissiondropscope-reference)
    - [`process.pid`](process.html#processpid)
    - [`process.platform`](process.html#processplatform)
    - [`process.ppid`](process.html#processppid)
    - [`process.ref(maybeRefable)`](process.html#processrefmayberefable)
    - [`process.release`](process.html#processrelease)
    - [`process.report`](process.html#processreport)
      * [`process.report.compact`](process.html#processreportcompact)
      * [`process.report.directory`](process.html#processreportdirectory)
      * [`process.report.filename`](process.html#processreportfilename)
      * [`process.report.getReport([err])`](process.html#processreportgetreporterr)
      * [`process.report.reportOnFatalError`](process.html#processreportreportonfatalerror)
      * [`process.report.reportOnSignal`](process.html#processreportreportonsignal)
      * [`process.report.reportOnUncaughtException`](process.html#processreportreportonuncaughtexception)
      * [`process.report.excludeEnv`](process.html#processreportexcludeenv)
      * [`process.report.signal`](process.html#processreportsignal)
      * [`process.report.writeReport([filename][, err])`](process.html#processreportwritereportfilename-err)
    - [`process.resourceUsage()`](process.html#processresourceusage)
    - [`process.send(message[, sendHandle[, options]][, callback])`](process.html#processsendmessage-sendhandle-options-callback)
    - [`process.setegid(id)`](process.html#processsetegidid)
    - [`process.seteuid(id)`](process.html#processseteuidid)
    - [`process.setgid(id)`](process.html#processsetgidid)
    - [`process.setgroups(groups)`](process.html#processsetgroupsgroups)
    - [`process.setuid(id)`](process.html#processsetuidid)
    - [`process.setSourceMapsEnabled(val)`](process.html#processsetsourcemapsenabledval)
    - [`process.setUncaughtExceptionCaptureCallback(fn)`](process.html#processsetuncaughtexceptioncapturecallbackfn)
    - [`process.sourceMapsEnabled`](process.html#processsourcemapsenabled)
    - [`process.stderr`](process.html#processstderr)
      * [`process.stderr.fd`](process.html#processstderrfd)
    - [`process.stdin`](process.html#processstdin)
      * [`process.stdin.fd`](process.html#processstdinfd)
    - [`process.stdout`](process.html#processstdout)
      * [`process.stdout.fd`](process.html#processstdoutfd)
      * [A note on process I/O](process.html#a-note-on-process-io)
    - [`process.throwDeprecation`](process.html#processthrowdeprecation)
    - [`process.threadCpuUsage([previousValue])`](process.html#processthreadcpuusagepreviousvalue)
    - [`process.title`](process.html#processtitle)
    - [`process.traceDeprecation`](process.html#processtracedeprecation)
    - [`process.traceProcessWarnings`](process.html#processtraceprocesswarnings)
    - [`process.umask()`](process.html#processumask)
    - [`process.umask(mask)`](process.html#processumaskmask)
    - [`process.unref(maybeRefable)`](process.html#processunrefmayberefable)
    - [`process.uptime()`](process.html#processuptime)
    - [`process.version`](process.html#processversion)
    - [`process.versions`](process.html#processversions)
    - [Exit codes](process.html#exit-codes)
* [Index](#gtoc-picker)

  + [Index](index.html)

  ---

  + [About this documentation](documentation.html)
  + [Usage and example](synopsis.html)
  + [Assertion testing](assert.html)
  + [Asynchronous context tracking](async_context.html)
  + [Async hooks](async_hooks.html)
  + [Benchmark runner](bench.html)
  + [Buffer](buffer.html)
  + [C++ addons](addons.html)
  + [C/C++ addons with Node-API](n-api.html)
  + [C++ embedder API](embedding.html)
  + [Child processes](child_process.html)
  + [Cluster](cluster.html)
  + [Command-line options](cli.html)
  + [Console](console.html)
  + [Crypto](crypto.html)
  + [Debugger](debugger.html)
  + [Deprecated APIs](deprecations.html)
  + [Diagnostics Channel](diagnostics_channel.html)
  + [DNS](dns.html)
  + [Domain](domain.html)
  + [Environment Variables](environment_variables.html)
  + [Errors](errors.html)
  + [Events](events.html)
  + [File system](fs.html)
  + [FFI](ffi.html)
  + [Globals](globals.html)
  + [HTTP](http.html)
  + [HTTP/2](http2.html)
  + [HTTPS](https.html)
  + [Inspector](inspector.html)
  + [Internationalization](intl.html)
  + [Iterable Streams API](stream_iter.html)
  + [Modules: CommonJS modules](modules.html)
  + [Modules: ECMAScript modules](esm.html)
  + [Modules: `node:module` API](module.html)
  + [Modules: Packages](packages.html)
  + [Modules: TypeScript](typescript.html)
  + [Net](net.html)
  + [OS](os.html)
  + [Path](path.html)
  + [Performance hooks](perf_hooks.html)
  + [Permissions](permissions.html)
  + [Process](process.html)
  + [Punycode](punycode.html)
  + [Query strings](querystring.html)
  + [Readline](readline.html)
  + [REPL](repl.html)
  + [Report](report.html)
  + [Single executable applications](single-executable-applications.html)
  + [SQLite](sqlite.html)
  + [Stream](stream.html)
  + [String decoder](string_decoder.html)
  + [Test runner](test.html)
  + [Timers](timers.html)
  + [TLS/SSL](tls.html)
  + [Trace events](tracing.html)
  + [TTY](tty.html)
  + [UDP/datagram](dgram.html)
  + [URL](url.html)
  + [Utilities](util.html)
  + [V8](v8.html)
  + [Virtual File System](vfs.html)
  + [VM](vm.html)
  + [WASI](wasi.html)
  + [Web Crypto API](webcrypto.html)
  + [Web Streams API](webstreams.html)
  + [Worker threads](worker_threads.html)
  + [Zlib](zlib.html)
* [Other versions](#alt-docs)

  1. [26.x](https://nodejs.org/docs/latest-v26.x/api/process.html) * [25.x](https://nodejs.org/docs/latest-v25.x/api/process.html) * [24.x **LTS**](https://nodejs.org/docs/latest-v24.x/api/process.html)* [23.x](https://nodejs.org/docs/latest-v23.x/api/process.html) * [22.x **LTS**](https://nodejs.org/docs/latest-v22.x/api/process.html)* [21.x](https://nodejs.org/docs/latest-v21.x/api/process.html) * [20.x](https://nodejs.org/docs/latest-v20.x/api/process.html) * [19.x](https://nodejs.org/docs/latest-v19.x/api/process.html) * [18.x](https://nodejs.org/docs/latest-v18.x/api/process.html) * [17.x](https://nodejs.org/docs/latest-v17.x/api/process.html) * [16.x](https://nodejs.org/docs/latest-v16.x/api/process.html) * [15.x](https://nodejs.org/docs/latest-v15.x/api/process.html) * [14.x](https://nodejs.org/docs/latest-v14.x/api/process.html) * [13.x](https://nodejs.org/docs/latest-v13.x/api/process.html) * [12.x](https://nodejs.org/docs/latest-v12.x/api/process.html) * [11.x](https://nodejs.org/docs/latest-v11.x/api/process.html) * [10.x](https://nodejs.org/docs/latest-v10.x/api/process.html) * [9.x](https://nodejs.org/docs/latest-v9.x/api/process.html) * [8.x](https://nodejs.org/docs/latest-v8.x/api/process.html) * [7.x](https://nodejs.org/docs/latest-v7.x/api/process.html) * [6.x](https://nodejs.org/docs/latest-v6.x/api/process.html) * [5.x](https://nodejs.org/docs/latest-v5.x/api/process.html) * [4.x](https://nodejs.org/docs/latest-v4.x/api/process.html) * [0.12.x](https://nodejs.org/docs/latest-v0.12.x/api/process.html) * [0.10.x](https://nodejs.org/docs/latest-v0.10.x/api/process.html)
* [Options](#options-picker)

  + [View on single page](all.html)
  + [View as JSON](process.json)
  + [Edit on GitHub](https://github.com/nodejs/node/edit/main/doc/api/process.md)

---

Table of contents

* [Process](process.html#process)
  + [Process events](process.html#process-events)
    - [Event: `'beforeExit'`](process.html#event-beforeexit)
    - [Event: `'disconnect'`](process.html#event-disconnect)
    - [Event: `'exit'`](process.html#event-exit)
    - [Event: `'message'`](process.html#event-message)
    - [Event: `'rejectionHandled'`](process.html#event-rejectionhandled)
    - [Event: `'workerMessage'`](process.html#event-workermessage)
    - [Event: `'uncaughtException'`](process.html#event-uncaughtexception)
      * [Warning: Using `'uncaughtException'` correctly](process.html#warning-using-uncaughtexception-correctly)
    - [Event: `'uncaughtExceptionMonitor'`](process.html#event-uncaughtexceptionmonitor)
    - [Event: `'unhandledRejection'`](process.html#event-unhandledrejection)
    - [Event: `'warning'`](process.html#event-warning)
      * [Emitting custom warnings](process.html#emitting-custom-warnings)
      * [Node.js warning names](process.html#nodejs-warning-names)
    - [Event: `'worker'`](process.html#event-worker)
    - [Signal events](process.html#signal-events)
  + [`process.abort()`](process.html#processabort)
  + [`process.addUncaughtExceptionCaptureCallback(fn)`](process.html#processadduncaughtexceptioncapturecallbackfn)
  + [`process.allowedNodeEnvironmentFlags`](process.html#processallowednodeenvironmentflags)
  + [`process.arch`](process.html#processarch)
  + [`process.argv`](process.html#processargv)
  + [`process.argv0`](process.html#processargv0)
  + [`process.availableMemory()`](process.html#processavailablememory)
  + [`process.channel`](process.html#processchannel)
    - [`process.channel.ref()`](process.html#processchannelref)
    - [`process.channel.unref()`](process.html#processchannelunref)
  + [`process.chdir(directory)`](process.html#processchdirdirectory)
  + [`process.config`](process.html#processconfig)
  + [`process.connected`](process.html#processconnected)
  + [`process.constrainedMemory()`](process.html#processconstrainedmemory)
  + [`process.cpuUsage([previousValue])`](process.html#processcpuusagepreviousvalue)
  + [`process.cwd()`](process.html#processcwd)
  + [`process.debugPort`](process.html#processdebugport)
  + [`process.disconnect()`](process.html#processdisconnect)
  + [`process.dlopen(module, filename[, flags])`](process.html#processdlopenmodule-filename-flags)
  + [`process.emitWarning(warning[, options])`](process.html#processemitwarningwarning-options)
  + [`process.emitWarning(warning[, type[, code]][, ctor])`](process.html#processemitwarningwarning-type-code-ctor)
    - [Avoiding duplicate warnings](process.html#avoiding-duplicate-warnings)
  + [`process.env`](process.html#processenv)
  + [`process.execArgv`](process.html#processexecargv)
  + [`process.execPath`](process.html#processexecpath)
  + [`process.execve(file[, args[, env]])`](process.html#processexecvefile-args-env)
  + [`process.exit([code])`](process.html#processexitcode)
  + [`process.exitCode`](process.html#processexitcode-1)
  + [`process.features.cached_builtins`](process.html#processfeaturescached_builtins)
  + [`process.features.debug`](process.html#processfeaturesdebug)
  + [`process.features.inspector`](process.html#processfeaturesinspector)
  + [`process.features.ipv6`](process.html#processfeaturesipv6)
  + [`process.features.require_module`](process.html#processfeaturesrequire_module)
  + [`process.features.tls`](process.html#processfeaturestls)
  + [`process.features.tls_alpn`](process.html#processfeaturestls_alpn)
  + [`process.features.tls_ocsp`](process.html#processfeaturestls_ocsp)
  + [`process.features.tls_sni`](process.html#processfeaturestls_sni)
  + [`process.features.typescript`](process.html#processfeaturestypescript)
  + [`process.features.uv`](process.html#processfeaturesuv)
  + [`process.finalization.register(ref, callback)`](process.html#processfinalizationregisterref-callback)
  + [`process.finalization.registerBeforeExit(ref, callback)`](process.html#processfinalizationregisterbeforeexitref-callback)
  + [`process.finalization.unregister(ref)`](process.html#processfinalizationunregisterref)
  + [`process.getActiveResourcesInfo()`](process.html#processgetactiveresourcesinfo)
  + [`process.getBuiltinModule(id)`](process.html#processgetbuiltinmoduleid)
  + [`process.getegid()`](process.html#processgetegid)
  + [`process.geteuid()`](process.html#processgeteuid)
  + [`process.getgid()`](process.html#processgetgid)
  + [`process.getgroups()`](process.html#processgetgroups)
  + [`process.getuid()`](process.html#processgetuid)
  + [`process.hasUncaughtExceptionCaptureCallback()`](process.html#processhasuncaughtexceptioncapturecallback)
  + [`process.hrtime([time])`](process.html#processhrtimetime)
  + [`process.hrtime.bigint()`](process.html#processhrtimebigint)
  + [`process.initgroups(user, extraGroup)`](process.html#processinitgroupsuser-extragroup)
  + [`process.kill(pid[, signal])`](process.html#processkillpid-signal)
  + [`process.loadEnvFile(path)`](process.html#processloadenvfilepath)
  + [`process.mainModule`](process.html#processmainmodule)
  + [`process.memoryUsage()`](process.html#processmemoryusage)
    - [A note on process memoryUsage](process.html#a-note-on-process-memoryusage)
  + [`process.memoryUsage.rss()`](process.html#processmemoryusagerss)
  + [`process.nextTick(callback[, ...args])`](process.html#processnexttickcallback-args)
    - [When to use `queueMicrotask()` vs. `process.nextTick()`](process.html#when-to-use-queuemicrotask-vs-processnexttick)
  + [`process.noDeprecation`](process.html#processnodeprecation)
  + [`process.permission`](process.html#processpermission)
    - [`process.permission.has(scope[, reference])`](process.html#processpermissionhasscope-reference)
    - [`process.permission.drop(scope[, reference])`](process.html#processpermissiondropscope-reference)
  + [`process.pid`](process.html#processpid)
  + [`process.platform`](process.html#processplatform)
  + [`process.ppid`](process.html#processppid)
  + [`process.ref(maybeRefable)`](process.html#processrefmayberefable)
  + [`process.release`](process.html#processrelease)
  + [`process.report`](process.html#processreport)
    - [`process.report.compact`](process.html#processreportcompact)
    - [`process.report.directory`](process.html#processreportdirectory)
    - [`process.report.filename`](process.html#processreportfilename)
    - [`process.report.getReport([err])`](process.html#processreportgetreporterr)
    - [`process.report.reportOnFatalError`](process.html#processreportreportonfatalerror)
    - [`process.report.reportOnSignal`](process.html#processreportreportonsignal)
    - [`process.report.reportOnUncaughtException`](process.html#processreportreportonuncaughtexception)
    - [`process.report.excludeEnv`](process.html#processreportexcludeenv)
    - [`process.report.signal`](process.html#processreportsignal)
    - [`process.report.writeReport([filename][, err])`](process.html#processreportwritereportfilename-err)
  + [`process.resourceUsage()`](process.html#processresourceusage)
  + [`process.send(message[, sendHandle[, options]][, callback])`](process.html#processsendmessage-sendhandle-options-callback)
  + [`process.setegid(id)`](process.html#processsetegidid)
  + [`process.seteuid(id)`](process.html#processseteuidid)
  + [`process.setgid(id)`](process.html#processsetgidid)
  + [`process.setgroups(groups)`](process.html#processsetgroupsgroups)
  + [`process.setuid(id)`](process.html#processsetuidid)
  + [`process.setSourceMapsEnabled(val)`](process.html#processsetsourcemapsenabledval)
  + [`process.setUncaughtExceptionCaptureCallback(fn)`](process.html#processsetuncaughtexceptioncapturecallbackfn)
  + [`process.sourceMapsEnabled`](process.html#processsourcemapsenabled)
  + [`process.stderr`](process.html#processstderr)
    - [`process.stderr.fd`](process.html#processstderrfd)
  + [`process.stdin`](process.html#processstdin)
    - [`process.stdin.fd`](process.html#processstdinfd)
  + [`process.stdout`](process.html#processstdout)
    - [`process.stdout.fd`](process.html#processstdoutfd)
    - [A note on process I/O](process.html#a-note-on-process-io)
  + [`process.throwDeprecation`](process.html#processthrowdeprecation)
  + [`process.threadCpuUsage([previousValue])`](process.html#processthreadcpuusagepreviousvalue)
  + [`process.title`](process.html#processtitle)
  + [`process.traceDeprecation`](process.html#processtracedeprecation)
  + [`process.traceProcessWarnings`](process.html#processtraceprocesswarnings)
  + [`process.umask()`](process.html#processumask)
  + [`process.umask(mask)`](process.html#processumaskmask)
  + [`process.unref(maybeRefable)`](process.html#processunrefmayberefable)
  + [`process.uptime()`](process.html#processuptime)
  + [`process.version`](process.html#processversion)
  + [`process.versions`](process.html#processversions)
  + [Exit codes](process.html#exit-codes)

## Process[#](#process)

**Source Code:** [lib/process.js](https://github.com/nodejs/node/blob/main/lib/process.js)

The `process` object provides information about, and control over, the current
Node.js process.

```
[ ] import process from 'node:process';
const process = require('node:process');

javascriptcopy
```

### Process events[#](#process-events)

The `process` object is an instance of [`EventEmitter`](events.html#class-eventemitter).

#### Event: `'beforeExit'`[#](#event-beforeexit)

Added in: v0.11.12

The `'beforeExit'` event is emitted when Node.js empties its event loop and has
no additional work to schedule. Normally, the Node.js process will exit when
there is no work scheduled, but a listener registered on the `'beforeExit'`
event can make asynchronous calls, and thereby cause the Node.js process to
continue.

The listener callback function is invoked with the value of
[`process.exitCode`](#processexitcode_1) passed as the only argument.

The `'beforeExit'` event is *not* emitted for conditions causing explicit
termination, such as calling [`process.exit()`](#processexitcode) or uncaught exceptions.

The `'beforeExit'` should *not* be used as an alternative to the `'exit'` event
unless the intention is to schedule additional work.

```
[ ] import process from 'node:process';

process.on('beforeExit', (code) => {
  console.log('Process beforeExit event with code: ', code);
});

process.on('exit', (code) => {
  console.log('Process exit event with code: ', code);
});

console.log('This message is displayed first.');

// Prints:
// This message is displayed first.
// Process beforeExit event with code: 0
// Process exit event with code: 0
process.on('beforeExit', (code) => {
  console.log('Process beforeExit event with code: ', code);
});

process.on('exit', (code) => {
  console.log('Process exit event with code: ', code);
});

console.log('This message is displayed first.');

// Prints:
// This message is displayed first.
// Process beforeExit event with code: 0
// Process exit event with code: 0

javascriptcopy
```

#### Event: `'disconnect'`[#](#event-disconnect)

Added in: v0.7.7

If the Node.js process is spawned with an IPC channel (see the [Child Process](child_process.html)
and [Cluster](cluster.html) documentation), the `'disconnect'` event will be emitted when
the IPC channel is closed.

#### Event: `'exit'`[#](#event-exit)

Added in: v0.1.7

* `code` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `'exit'` event is emitted when the Node.js process is about to exit as a
result of either:

* The `process.exit()` method being called explicitly;
* The Node.js event loop no longer having any additional work to perform.

There is no way to prevent the exiting of the event loop at this point, and once
all `'exit'` listeners have finished running the Node.js process will terminate.

The listener callback function is invoked with the exit code specified either
by the [`process.exitCode`](#processexitcode_1) property, or the `exitCode` argument passed to the
[`process.exit()`](#processexitcode) method.

```
[ ] import process from 'node:process';

process.on('exit', (code) => {
  console.log(`About to exit with code: ${code}`);
});
process.on('exit', (code) => {
  console.log(`About to exit with code: ${code}`);
});

javascriptcopy
```

Listener functions **must** only perform **synchronous** operations. The Node.js
process will exit immediately after calling the `'exit'` event listeners
causing any additional work still queued in the event loop to be abandoned.
In the following example, for instance, the timeout will never occur:

```
[ ] import process from 'node:process';

process.on('exit', (code) => {
  setTimeout(() => {
    console.log('This will not run');
  }, 0);
});
process.on('exit', (code) => {
  setTimeout(() => {
    console.log('This will not run');
  }, 0);
});

javascriptcopy
```

#### Event: `'message'`[#](#event-message)

Added in: v0.5.10

* `message` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<null>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#null_type) a parsed JSON object
  or a serializable primitive value.
* `sendHandle` [`<net.Server>`](net.html#class-netserver) | [`<net.Socket>`](net.html#class-netsocket) a [`net.Server`](net.html#class-netserver) or [`net.Socket`](net.html#class-netsocket)
  object, or undefined.

If the Node.js process is spawned with an IPC channel (see the [Child Process](child_process.html)
and [Cluster](cluster.html) documentation), the `'message'` event is emitted whenever a
message sent by a parent process using [`childprocess.send()`](child_process.html#subprocesssendmessage-sendhandle-options-callback) is received by
the child process.

The message goes through serialization and parsing. The resulting message might
not be the same as what is originally sent.

If the `serialization` option was set to `advanced` used when spawning the
process, the `message` argument can contain data that JSON is not able
to represent.
See [Advanced serialization for `child_process`](child_process.html#advanced-serialization) for more details.

#### Event: `'rejectionHandled'`[#](#event-rejectionhandled)

Added in: v1.4.1

* `promise` [`<Promise>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise) The late handled promise.

The `'rejectionHandled'` event is emitted whenever a `Promise` has been rejected
and an error handler was attached to it (using [`promise.catch()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch), for
example) later than one turn of the Node.js event loop.

The `Promise` object would have previously been emitted in an
`'unhandledRejection'` event, but during the course of processing gained a
rejection handler.

There is no notion of a top level for a `Promise` chain at which rejections can
always be handled. Being inherently asynchronous in nature, a `Promise`
rejection can be handled at a future point in time, possibly much later than
the event loop turn it takes for the `'unhandledRejection'` event to be emitted.

Another way of stating this is that, unlike in synchronous code where there is
an ever-growing list of unhandled exceptions, with Promises there can be a
growing-and-shrinking list of unhandled rejections.

In synchronous code, the `'uncaughtException'` event is emitted when the list of
unhandled exceptions grows.

In asynchronous code, the `'unhandledRejection'` event is emitted when the list
of unhandled rejections grows, and the `'rejectionHandled'` event is emitted
when the list of unhandled rejections shrinks.

```
[ ] import process from 'node:process';

const unhandledRejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
  unhandledRejections.set(promise, reason);
});
process.on('rejectionHandled', (promise) => {
  unhandledRejections.delete(promise);
});
const unhandledRejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
  unhandledRejections.set(promise, reason);
});
process.on('rejectionHandled', (promise) => {
  unhandledRejections.delete(promise);
});

javascriptcopy
```

In this example, the `unhandledRejections` `Map` will grow and shrink over time,
reflecting rejections that start unhandled and then become handled. It is
possible to record such errors in an error log, either periodically (which is
likely best for long-running application) or upon process exit (which is likely
most convenient for scripts).

#### Event: `'workerMessage'`[#](#event-workermessage)

Added in: v22.5.0, v20.19.0

* `value` [`<any>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#Data_types) A value transmitted using [`postMessageToThread()`](worker_threads.html#worker_threadspostmessagetothreadthreadid-value-transferlist-timeout).
* `source` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) The transmitting worker thread ID or `0` for the main thread.

The `'workerMessage'` event is emitted for any incoming message send by the other
party by using [`postMessageToThread()`](worker_threads.html#worker_threadspostmessagetothreadthreadid-value-transferlist-timeout).

#### Event: `'uncaughtException'`[#](#event-uncaughtexception)

Added in: v0.1.18History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v12.0.0, v10.17.0 Added the `origin` argument. | | | |

* `err` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) The uncaught exception.
* `origin` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) Indicates if the exception originates from an unhandled
  rejection or from a synchronous error. Can either be `'uncaughtException'` or
  `'unhandledRejection'`. The latter is used when an exception happens in a
  `Promise` based async context (or if a `Promise` is rejected) and
  [`--unhandled-rejections`](cli.html#--unhandled-rejectionsmode) flag set to `strict` or `throw` (which is the
  default) and the rejection is not handled, or when a rejection happens during
  the command line entry point's ES module static loading phase.

The `'uncaughtException'` event is emitted when an uncaught JavaScript
exception bubbles all the way back to the event loop. By default, Node.js
handles such exceptions by printing the stack trace to `stderr` and exiting
with code 1, overriding any previously set [`process.exitCode`](#processexitcode_1).
Adding a handler for the `'uncaughtException'` event overrides this default
behavior. Alternatively, change the [`process.exitCode`](#processexitcode_1) in the
`'uncaughtException'` handler which will result in the process exiting with the
provided exit code. Otherwise, in the presence of such handler the process will
exit with 0.

```
[ ] import process from 'node:process';
import fs from 'node:fs';

process.on('uncaughtException', (err, origin) => {
  fs.writeSync(
    process.stderr.fd,
    `Caught exception: ${err}\n` +
    `Exception origin: ${origin}\n`,
  );
});

setTimeout(() => {
  console.log('This will still run.');
}, 500);

// Intentionally cause an exception, but don't catch it.
nonexistentFunc();
console.log('This will not run.');
const fs = require('node:fs');

process.on('uncaughtException', (err, origin) => {
  fs.writeSync(
    process.stderr.fd,
    `Caught exception: ${err}\n` +
    `Exception origin: ${origin}\n`,
  );
});

setTimeout(() => {
  console.log('This will still run.');
}, 500);

// Intentionally cause an exception, but don't catch it.
nonexistentFunc();
console.log('This will not run.');

javascriptcopy
```

It is possible to monitor `'uncaughtException'` events without overriding the
default behavior to exit the process by installing a
`'uncaughtExceptionMonitor'` listener.

##### Warning: Using `'uncaughtException'` correctly[#](#warning-using-uncaughtexception-correctly)

`'uncaughtException'` is a crude mechanism for exception handling
intended to be used only as a last resort. The event *should not* be used as
an equivalent to `On Error Resume Next`. Unhandled exceptions inherently mean
that an application is in an undefined state. Attempting to resume application
code without properly recovering from the exception can cause additional
unforeseen and unpredictable issues.

Exceptions thrown from within the event handler will not be caught. Instead the
process will exit with a non-zero exit code and the stack trace will be printed.
This is to avoid infinite recursion.

Attempting to resume normally after an uncaught exception can be similar to
pulling out the power cord when upgrading a computer. Nine out of ten
times, nothing happens. But the tenth time, the system becomes corrupted.

The correct use of `'uncaughtException'` is to perform synchronous cleanup
of allocated resources (e.g. file descriptors, handles, etc) before shutting
down the process. **It is not safe to resume normal operation after
`'uncaughtException'`.**

To restart a crashed application in a more reliable way, whether
`'uncaughtException'` is emitted or not, an external monitor should be employed
in a separate process to detect application failures and recover or restart as
needed.

#### Event: `'uncaughtExceptionMonitor'`[#](#event-uncaughtexceptionmonitor)

Added in: v13.7.0, v12.17.0

* `err` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) The uncaught exception.
* `origin` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) Indicates if the exception originates from an unhandled
  rejection or from synchronous errors. Can either be `'uncaughtException'` or
  `'unhandledRejection'`. The latter is used when an exception happens in a
  `Promise` based async context (or if a `Promise` is rejected) and
  [`--unhandled-rejections`](cli.html#--unhandled-rejectionsmode) flag set to `strict` or `throw` (which is the
  default) and the rejection is not handled, or when a rejection happens during
  the command line entry point's ES module static loading phase.

The `'uncaughtExceptionMonitor'` event is emitted before an
`'uncaughtException'` event is emitted or a hook installed via
[`process.setUncaughtExceptionCaptureCallback()`](#processsetuncaughtexceptioncapturecallbackfn) is called.

Installing an `'uncaughtExceptionMonitor'` listener does not change the behavior
once an `'uncaughtException'` event is emitted. The process will
still crash if no `'uncaughtException'` listener is installed.

```
[ ] import process from 'node:process';

process.on('uncaughtExceptionMonitor', (err, origin) => {
  MyMonitoringTool.logSync(err, origin);
});

// Intentionally cause an exception, but don't catch it.
nonexistentFunc();
// Still crashes Node.js
process.on('uncaughtExceptionMonitor', (err, origin) => {
  MyMonitoringTool.logSync(err, origin);
});

// Intentionally cause an exception, but don't catch it.
nonexistentFunc();
// Still crashes Node.js

javascriptcopy
```

#### Event: `'unhandledRejection'`[#](#event-unhandledrejection)

Added in: v1.4.1History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v7.0.0 Not handling `Promise` rejections is deprecated.| v6.6.0 Unhandled `Promise` rejections will now emit a process warning. | | | | | |

* `reason` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) | [`<any>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#Data_types) The object with which the promise was rejected
  (typically an [`Error`](errors.html#class-error) object).
* `promise` [`<Promise>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise) The rejected promise.

The `'unhandledRejection'` event is emitted whenever a `Promise` is rejected and
no error handler is attached to the promise within a turn of the event loop.
When programming with Promises, exceptions are encapsulated as "rejected
promises". Rejections can be caught and handled using [`promise.catch()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch) and
are propagated through a `Promise` chain. The `'unhandledRejection'` event is
useful for detecting and keeping track of promises that were rejected whose
rejections have not yet been handled.

```
[ ] import process from 'node:process';

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

somePromise.then((res) => {
  return reportToUser(JSON.pasre(res)); // Note the typo (`pasre`)
}); // No `.catch()` or `.then()`
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

somePromise.then((res) => {
  return reportToUser(JSON.pasre(res)); // Note the typo (`pasre`)
}); // No `.catch()` or `.then()`

javascriptcopy
```

The following will also trigger the `'unhandledRejection'` event to be
emitted:

```
[ ] import process from 'node:process';

function SomeResource() {
  // Initially set the loaded status to a rejected promise
  this.loaded = Promise.reject(new Error('Resource not yet loaded!'));
}

const resource = new SomeResource();
// no .catch or .then on resource.loaded for at least a turn
function SomeResource() {
  // Initially set the loaded status to a rejected promise
  this.loaded = Promise.reject(new Error('Resource not yet loaded!'));
}

const resource = new SomeResource();
// no .catch or .then on resource.loaded for at least a turn

javascriptcopy
```

In this example case, it is possible to track the rejection as a developer error
as would typically be the case for other `'unhandledRejection'` events. To
address such failures, a non-operational
[`.catch(() => { })`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch) handler may be attached to
`resource.loaded`, which would prevent the `'unhandledRejection'` event from
being emitted.

If an `'unhandledRejection'` event is emitted but not handled it will
be raised as an uncaught exception. This alongside other behaviors of
`'unhandledRejection'` events can changed via the [`--unhandled-rejections`](cli.html#--unhandled-rejectionsmode) flag.

#### Event: `'warning'`[#](#event-warning)

Added in: v6.0.0

* `warning` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) Key properties of the warning are:
  + `name` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) The name of the warning. **Default:** `'Warning'`.
  + `message` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) A system-provided description of the warning.
  + `stack` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) A stack trace to the location in the code where the warning
    was issued.

The `'warning'` event is emitted whenever Node.js emits a process warning.

A process warning is similar to an error in that it describes exceptional
conditions that are being brought to the user's attention. However, warnings
are not part of the normal Node.js and JavaScript error handling flow.
Node.js can emit warnings whenever it detects bad coding practices that could
lead to sub-optimal application performance, bugs, or security vulnerabilities.

```
[ ] import process from 'node:process';

process.on('warning', (warning) => {
  console.warn(warning.name);    // Print the warning name
  console.warn(warning.message); // Print the warning message
  console.warn(warning.stack);   // Print the stack trace
});
process.on('warning', (warning) => {
  console.warn(warning.name);    // Print the warning name
  console.warn(warning.message); // Print the warning message
  console.warn(warning.stack);   // Print the stack trace
});

javascriptcopy
```

By default, Node.js will print process warnings to `stderr`. The `--no-warnings`
command-line option can be used to suppress the default console output but the
`'warning'` event will still be emitted by the `process` object. Currently, it
is not possible to suppress specific warning types other than deprecation
warnings. To suppress deprecation warnings, check out the [`--no-deprecation`](cli.html#--no-deprecation)
flag.

The following example illustrates the warning that is printed to `stderr` when
too many listeners have been added to an event:

```
$ node
> events.defaultMaxListeners = 1;
> process.on('foo', () => {});
> process.on('foo', () => {});
> (node:38638) MaxListenersExceededWarning: Possible EventEmitter memory leak
detected. 2 foo listeners added. Use emitter.setMaxListeners() to increase limit

consolecopy
```

In contrast, the following example turns off the default warning output and
adds a custom handler to the `'warning'` event:

```
$ node --no-warnings
> const p = process.on('warning', (warning) => console.warn('Do not do that!'));
> events.defaultMaxListeners = 1;
> process.on('foo', () => {});
> process.on('foo', () => {});
> Do not do that!

consolecopy
```

The `--trace-warnings` command-line option can be used to have the default
console output for warnings include the full stack trace of the warning.

Launching Node.js using the `--throw-deprecation` command-line flag will
cause custom deprecation warnings to be thrown as exceptions.

Using the `--trace-deprecation` command-line flag will cause the custom
deprecation to be printed to `stderr` along with the stack trace.

Using the `--no-deprecation` command-line flag will suppress all reporting
of the custom deprecation.

The `*-deprecation` command-line flags only affect warnings that use the name
`'DeprecationWarning'`.

##### Emitting custom warnings[#](#emitting-custom-warnings)

See the [`process.emitWarning()`](#processemitwarningwarning-type-code-ctor) method for issuing
custom or application-specific warnings.

##### Node.js warning names[#](#nodejs-warning-names)

There are no strict guidelines for warning types (as identified by the `name`
property) emitted by Node.js. New types of warnings can be added at any time.
A few of the warning types that are most common include:

* `'DeprecationWarning'` - Indicates use of a deprecated Node.js API or feature.
  Such warnings must include a `'code'` property identifying the
  [deprecation code](deprecations.html).
* `'ExperimentalWarning'` - Indicates use of an experimental Node.js API or
  feature. Such features must be used with caution as they may change at any
  time and are not subject to the same strict semantic-versioning and long-term
  support policies as supported features.
* `'MaxListenersExceededWarning'` - Indicates that too many listeners for a
  given event have been registered on either an `EventEmitter` or `EventTarget`.
  This is often an indication of a memory leak.
* `'TimeoutOverflowWarning'` - Indicates that a numeric value that cannot fit
  within a 32-bit signed integer has been provided to either the `setTimeout()`
  or `setInterval()` functions.
* `'TimeoutNegativeWarning'` - Indicates that a negative number has provided to
  either the `setTimeout()` or `setInterval()` functions.
* `'TimeoutNaNWarning'` - Indicates that a value which is not a number has
  provided to either the `setTimeout()` or `setInterval()` functions.
* `'UnsupportedWarning'` - Indicates use of an unsupported option or feature
  that will be ignored rather than treated as an error. One example is use of
  the HTTP response status message when using the HTTP/2 compatibility API.

#### Event: `'worker'`[#](#event-worker)

Added in: v16.2.0, v14.18.0

* `worker` [`<Worker>`](worker_threads.html#class-worker) The [`<Worker>`](worker_threads.html#class-worker) that was created.

The `'worker'` event is emitted after a new [`<Worker>`](worker_threads.html#class-worker) thread has been created.

#### Signal events[#](#signal-events)

Signal events will be emitted when the Node.js process receives a signal. Please
refer to [`signal(7)`](http://man7.org/linux/man-pages/man7/signal.7.html) for a listing of standard POSIX signal names such as `'SIGINT'`, `'SIGHUP'`, etc.

Signals are not available on [`Worker`](worker_threads.html#class-worker) threads.

The signal handler will receive the signal's name (`'SIGINT'`,
`'SIGTERM'`, etc.) as the first argument.

The name of each event will be the uppercase common name for the signal (e.g.
`'SIGINT'` for `SIGINT` signals).

```
[ ] import process from 'node:process';

// Begin reading from stdin so the process does not exit.
process.stdin.resume();

process.on('SIGINT', () => {
  console.log('Received SIGINT. Press Control-D to exit.');
});

// Using a single function to handle multiple signals
function handle(signal) {
  console.log(`Received ${signal}`);
}

process.on('SIGINT', handle);
process.on('SIGTERM', handle);
// Begin reading from stdin so the process does not exit.
process.stdin.resume();

process.on('SIGINT', () => {
  console.log('Received SIGINT. Press Control-D to exit.');
});

// Using a single function to handle multiple signals
function handle(signal) {
  console.log(`Received ${signal}`);
}

process.on('SIGINT', handle);
process.on('SIGTERM', handle);

javascriptcopy
```

* `'SIGUSR1'` is reserved by Node.js to start the [debugger](debugger.html). It's possible to
  install a listener but doing so might interfere with the debugger.
* `'SIGTERM'` and `'SIGINT'` have default handlers on non-Windows platforms that
  reset the terminal mode before exiting with code `128 + signal number`. If one
  of these signals has a listener installed, its default behavior will be
  removed. Signal events are emitted asynchronously, so Node.js may exit before
  the listener is called if the event loop is otherwise empty.
* `'SIGPIPE'` is ignored by default. It can have a listener installed.
* `'SIGHUP'` is generated on Windows when the console window is closed, and on
  other platforms under various similar conditions. See [`signal(7)`](http://man7.org/linux/man-pages/man7/signal.7.html). It can have a
  listener installed, however Node.js will be unconditionally terminated by
  Windows about 10 seconds later. On non-Windows platforms, the default
  behavior of `SIGHUP` is to terminate Node.js, but once a listener has been
  installed its default behavior will be removed.
* `'SIGTERM'` is not supported on Windows, it can be listened on.
* `'SIGINT'` from the terminal is supported on all platforms, and can usually be
  generated with `Ctrl`+`C` (though this may be configurable).
  It is not generated when [terminal raw mode](tty.html#readstreamsetrawmodemode) is enabled
  and `Ctrl`+`C` is used.
* `'SIGBREAK'` is delivered on Windows when `Ctrl`+`Break` is
  pressed. On non-Windows platforms, it can be listened on, but there is no way
  to send or generate it.
* `'SIGWINCH'` is delivered when the console has been resized. On Windows, this
  will only happen on write to the console when the cursor is being moved, or
  when a readable tty is used in raw mode.
* `'SIGKILL'` cannot have a listener installed, it will unconditionally
  terminate Node.js on all platforms.
* `'SIGSTOP'` cannot have a listener installed.
* `'SIGBUS'`, `'SIGFPE'`, `'SIGSEGV'`, and `'SIGILL'`, when not raised
  artificially using [`kill(2)`](http://man7.org/linux/man-pages/man2/kill.2.html), inherently leave the process in a state from
  which it is not safe to call JS listeners. Doing so might cause the process
  to stop responding.
* `0` can be sent to test for the existence of a process, it has no effect if
  the process exists, but will throw an error if the process does not exist.

Windows does not support signals so has no equivalent to termination by signal,
but Node.js offers some emulation with [`process.kill()`](#processkillpid-signal), and
[`subprocess.kill()`](child_process.html#subprocesskillsignal):

* Sending `SIGINT`, `SIGTERM`, and `SIGKILL` will cause the unconditional
  termination of the target process, and afterwards, subprocess will report that
  the process was terminated by signal.
* Sending signal `0` can be used as a platform independent way to test for the
  existence of a process.

### `process.abort()`[#](#processabort)

Added in: v0.7.0

The `process.abort()` method causes the Node.js process to exit immediately and
generate a core file.

This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.addUncaughtExceptionCaptureCallback(fn)`[#](#processadduncaughtexceptioncapturecallbackfn)

Added in: v25.9.0

[Stability: 1](documentation.html#stability-index) - Experimental

* `fn` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function)

The `process.addUncaughtExceptionCaptureCallback()` function adds a callback
that will be invoked when an uncaught exception occurs, receiving the exception
value as its first argument.

Unlike [`process.setUncaughtExceptionCaptureCallback()`](#processsetuncaughtexceptioncapturecallbackfn), this function allows
multiple callbacks to be registered and does not conflict with the
[`domain`](domain.html) module. Callbacks are called in reverse order of registration
(most recent first). If a callback returns `true`, subsequent callbacks
and the default uncaught exception handling are skipped.

```
[ ] import process from 'node:process';

process.addUncaughtExceptionCaptureCallback((err) => {
  console.error('Caught exception:', err.message);
  return true; // Indicates exception was handled
});
process.addUncaughtExceptionCaptureCallback((err) => {
  console.error('Caught exception:', err.message);
  return true; // Indicates exception was handled
});

javascriptcopy
```

### `process.allowedNodeEnvironmentFlags`[#](#processallowednodeenvironmentflags)

Added in: v10.10.0

* Type: [`<Set>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Set)

The `process.allowedNodeEnvironmentFlags` property is a special,
read-only `Set` of flags allowable within the [`NODE_OPTIONS`](cli.html#node_optionsoptions)
environment variable.

`process.allowedNodeEnvironmentFlags` extends `Set`, but overrides
`Set.prototype.has` to recognize several different possible flag
representations. `process.allowedNodeEnvironmentFlags.has()` will
return `true` in the following cases:

* Flags may omit leading single (`-`) or double (`--`) dashes; e.g.,
  `inspect-brk` for `--inspect-brk`, or `r` for `-r`.
* Flags passed through to V8 (as listed in `--v8-options`) may replace
  one or more *non-leading* dashes for an underscore, or vice-versa;
  e.g., `--perf_basic_prof`, `--perf-basic-prof`, `--perf_basic-prof`,
  etc.
* Flags may contain one or more equals (`=`) characters; all
  characters after and including the first equals will be ignored;
  e.g., `--stack-trace-limit=100`.
* Flags *must* be allowable within [`NODE_OPTIONS`](cli.html#node_optionsoptions).

When iterating over `process.allowedNodeEnvironmentFlags`, flags will
appear only *once*; each will begin with one or more dashes. Flags
passed through to V8 will contain underscores instead of non-leading
dashes:

```
[ ] import { allowedNodeEnvironmentFlags } from 'node:process';

allowedNodeEnvironmentFlags.forEach((flag) => {
  // -r
  // --inspect-brk
  // --abort_on_uncaught_exception
  // ...
});
const { allowedNodeEnvironmentFlags } = require('node:process');

allowedNodeEnvironmentFlags.forEach((flag) => {
  // -r
  // --inspect-brk
  // --abort_on_uncaught_exception
  // ...
});

javascriptcopy
```

The methods `add()`, `clear()`, and `delete()` of
`process.allowedNodeEnvironmentFlags` do nothing, and will fail
silently.

If Node.js was compiled *without* [`NODE_OPTIONS`](cli.html#node_optionsoptions) support (shown in
[`process.config`](#processconfig)), `process.allowedNodeEnvironmentFlags` will
contain what *would have* been allowable.

### `process.arch`[#](#processarch)

Added in: v0.5.0

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The operating system CPU architecture for which the Node.js binary was compiled.
Possible values are: `'arm'`, `'arm64'`, `'ia32'`, `'loong64'`, `'mips'`,
`'mipsel'`, `'ppc64'`, `'riscv64'`, `'s390'`, `'s390x'`, and `'x64'`.

```
[ ] import { arch } from 'node:process';

console.log(`This processor architecture is ${arch}`);
const { arch } = require('node:process');

console.log(`This processor architecture is ${arch}`);

javascriptcopy
```

### `process.argv`[#](#processargv)

Added in: v0.1.27

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)[]

The `process.argv` property returns an array containing the command-line
arguments passed when the Node.js process was launched. The first element will
be [`process.execPath`](#processexecpath). See `process.argv0` if access to the original value
of `argv[0]` is needed. If a [program entry point](https://nodejs.org/api/cli.html#program-entry-point) was provided, the second element
will be the absolute path to it. The remaining elements are additional command-line
arguments.

For example, assuming the following script for `process-args.js`:

```
[ ] import { argv } from 'node:process';

// print process.argv
argv.forEach((val, index) => {
  console.log(`${index}: ${val}`);
});
const { argv } = require('node:process');

// print process.argv
argv.forEach((val, index) => {
  console.log(`${index}: ${val}`);
});

javascriptcopy
```

Launching the Node.js process as:

```
node process-args.js one two=three four

bashcopy
```

Would generate the output:

```
0: /usr/local/bin/node
1: /Users/mjr/work/node/process-args.js
2: one
3: two=three
4: four

textcopy
```

### `process.argv0`[#](#processargv0)

Added in: v6.4.0

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.argv0` property stores a read-only copy of the original value of
`argv[0]` passed when Node.js starts.

```
$ bash -c 'exec -a customArgv0 ./node'
> process.argv[0]
'/Volumes/code/external/node/out/Release/node'
> process.argv0
'customArgv0'

consolecopy
```

### `process.availableMemory()`[#](#processavailablememory)

Added in: v22.0.0, v20.13.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v24.0.0, v22.16.0 Change stability index for this feature from Experimental to Stable. | | | |

* Returns: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

Gets the amount of free memory that is still available to the process
(in bytes).

See [`uv_get_available_memory`](https://docs.libuv.org/en/v1.x/misc.html#c.uv_get_available_memory) for more
information.

### `process.channel`[#](#processchannel)

Added in: v7.1.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v14.0.0 The object no longer accidentally exposes native C++ bindings. | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

If the Node.js process was spawned with an IPC channel (see the
[Child Process](child_process.html) documentation), the `process.channel`
property is a reference to the IPC channel. If no IPC channel exists, this
property is `undefined`.

#### `process.channel.ref()`[#](#processchannelref)

Added in: v7.1.0

This method makes the IPC channel keep the event loop of the process
running if `.unref()` has been called before.

Typically, this is managed through the number of `'disconnect'` and `'message'`
listeners on the `process` object. However, this method can be used to
explicitly request a specific behavior.

#### `process.channel.unref()`[#](#processchannelunref)

Added in: v7.1.0

This method makes the IPC channel not keep the event loop of the process
running, and lets it finish even while the channel is open.

Typically, this is managed through the number of `'disconnect'` and `'message'`
listeners on the `process` object. However, this method can be used to
explicitly request a specific behavior.

### `process.chdir(directory)`[#](#processchdirdirectory)

Added in: v0.1.17

* `directory` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.chdir()` method changes the current working directory of the
Node.js process or throws an exception if doing so fails (for instance, if
the specified `directory` does not exist).

```
[ ] import { chdir, cwd } from 'node:process';

console.log(`Starting directory: ${cwd()}`);
try {
  chdir('/tmp');
  console.log(`New directory: ${cwd()}`);
} catch (err) {
  console.error(`chdir: ${err}`);
}
const { chdir, cwd } = require('node:process');

console.log(`Starting directory: ${cwd()}`);
try {
  chdir('/tmp');
  console.log(`New directory: ${cwd()}`);
} catch (err) {
  console.error(`chdir: ${err}`);
}

javascriptcopy
```

This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.config`[#](#processconfig)

Added in: v0.7.7History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v19.0.0 The `process.config` object is now frozen.| v16.0.0 Modifying process.config has been deprecated. | | | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.config` property returns a frozen `Object` containing the
JavaScript representation of the configure options used to compile the current
Node.js executable. This is the same as the `config.gypi` file that was produced
when running the `./configure` script.

An example of the possible output looks like:

```
{
  "target_defaults":
   { "cflags": [],
     "default_configuration": "Release",
     "defines": [],
     "include_dirs": [],
     "libraries": [] },
  "variables":
   {
     "host_arch": "x64",
     "napi_build_version": 5,
     "node_install_npm": "true",
     "node_prefix": "",
     "node_shared_cares": "false",
     "node_shared_http_parser": "false",
     "node_shared_libuv": "false",
     "node_shared_zlib": "false",
     "node_use_openssl": "true",
     "node_shared_openssl": "false",
     "target_arch": "x64",
     "v8_use_snapshot": 1
   }
}

jsoncopy
```

### `process.connected`[#](#processconnected)

Added in: v0.7.2

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If the Node.js process is spawned with an IPC channel (see the [Child Process](child_process.html)
and [Cluster](cluster.html) documentation), the `process.connected` property will return
`true` so long as the IPC channel is connected and will return `false` after
`process.disconnect()` is called.

Once `process.connected` is `false`, it is no longer possible to send messages
over the IPC channel using `process.send()`.

### `process.constrainedMemory()`[#](#processconstrainedmemory)

Added in: v19.6.0, v18.15.0History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v24.0.0, v22.16.0 Change stability index for this feature from Experimental to Stable.|  |  | | --- | --- | | v22.0.0, v20.13.0 Aligned return value with `uv_get_constrained_memory`. | | | | | |

* Returns: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

Gets the amount of memory available to the process (in bytes) based on
limits imposed by the OS. If there is no such constraint, or the constraint
is unknown, `0` is returned.

See [`uv_get_constrained_memory`](https://docs.libuv.org/en/v1.x/misc.html#c.uv_get_constrained_memory) for more
information.

### `process.cpuUsage([previousValue])`[#](#processcpuusagepreviousvalue)

Added in: v6.1.0

* `previousValue` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) A previous return value from calling `process.cpuUsage()`
* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
  + `user` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `system` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.cpuUsage()` method returns the user and system CPU time usage of
the current process, in an object with properties `user` and `system`, whose
values are microsecond values (millionth of a second). These values measure time
spent in user and system code respectively, and may end up being greater than
actual elapsed time if multiple CPU cores are performing work for this process.

The result of a previous call to `process.cpuUsage()` can be passed as the
argument to the function, to get a diff reading.

```
[ ] import { cpuUsage } from 'node:process';

const startUsage = cpuUsage();
// { user: 38579, system: 6986 }

// spin the CPU for 500 milliseconds
const now = Date.now();
while (Date.now() - now < 500);

console.log(cpuUsage(startUsage));
// { user: 514883, system: 11226 }
const { cpuUsage } = require('node:process');

const startUsage = cpuUsage();
// { user: 38579, system: 6986 }

// spin the CPU for 500 milliseconds
const now = Date.now();
while (Date.now() - now < 500);

console.log(cpuUsage(startUsage));
// { user: 514883, system: 11226 }

javascriptcopy
```

### `process.cwd()`[#](#processcwd)

Added in: v0.1.8

* Returns: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.cwd()` method returns the current working directory of the Node.js
process.

```
[ ] import { cwd } from 'node:process';

console.log(`Current directory: ${cwd()}`);
const { cwd } = require('node:process');

console.log(`Current directory: ${cwd()}`);

javascriptcopy
```

### `process.debugPort`[#](#processdebugport)

Added in: v0.7.2

* Type: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The port used by the Node.js debugger when enabled.

```
[ ] import process from 'node:process';

process.debugPort = 5858;
process.debugPort = 5858;

javascriptcopy
```

### `process.disconnect()`[#](#processdisconnect)

Added in: v0.7.2

If the Node.js process is spawned with an IPC channel (see the [Child Process](child_process.html)
and [Cluster](cluster.html) documentation), the `process.disconnect()` method will close the
IPC channel to the parent process, allowing the child process to exit gracefully
once there are no other connections keeping it alive.

The effect of calling `process.disconnect()` is the same as calling
[`ChildProcess.disconnect()`](child_process.html#subprocessdisconnect) from the parent process.

If the Node.js process was not spawned with an IPC channel,
`process.disconnect()` will be `undefined`.

### `process.dlopen(module, filename[, flags])`[#](#processdlopenmodule-filename-flags)

Added in: v0.1.16History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v9.0.0 Added support for the `flags` argument. | | | |

* `module` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
* `filename` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)
* `flags` [`<os.constants.dlopen>`](os.html#dlopen-constants) **Default:** `os.constants.dlopen.RTLD_LAZY`

The `process.dlopen()` method allows dynamically loading shared objects. It is
primarily used by `require()` to load C++ Addons, and should not be used
directly, except in special cases. In other words, [`require()`](globals.html#require) should be
preferred over `process.dlopen()` unless there are specific reasons such as
custom dlopen flags or loading from ES modules.

The `flags` argument is an integer that allows to specify dlopen
behavior. See the [`os.constants.dlopen`](os.html#dlopen-constants) documentation for details.

An important requirement when calling `process.dlopen()` is that the `module`
instance must be passed. Functions exported by the C++ Addon are then
accessible via `module.exports`.

The example below shows how to load a C++ Addon, named `local.node`,
that exports a `foo` function. All the symbols are loaded before
the call returns, by passing the `RTLD_NOW` constant. In this example
the constant is assumed to be available.

```
[ ] import { dlopen } from 'node:process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const module = { exports: {} };
dlopen(module, fileURLToPath(new URL('local.node', import.meta.url)),
       constants.dlopen.RTLD_NOW);
module.exports.foo();
const { dlopen } = require('node:process');
const { constants } = require('node:os');
const { join } = require('node:path');

const module = { exports: {} };
dlopen(module, join(__dirname, 'local.node'), constants.dlopen.RTLD_NOW);
module.exports.foo();

javascriptcopy
```

### `process.emitWarning(warning[, options])`[#](#processemitwarningwarning-options)

Added in: v8.0.0

* `warning` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) The warning to emit.
* `options` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
  + `type` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) When `warning` is a `String`, `type` is the name to use
    for the *type* of warning being emitted. **Default:** `'Warning'`.
  + `code` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) A unique identifier for the warning instance being emitted.
  + `ctor` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) When `warning` is a `String`, `ctor` is an optional
    function used to limit the generated stack trace. **Default:**
    `process.emitWarning`.
  + `detail` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) Additional text to include with the error.

The `process.emitWarning()` method can be used to emit custom or application
specific process warnings. These can be listened for by adding a handler to the
[`'warning'`](#event-warning) event.

```
[ ] import { emitWarning } from 'node:process';

// Emit a warning with a code and additional detail.
emitWarning('Something happened!', {
  code: 'MY_WARNING',
  detail: 'This is some additional information',
});
// Emits:
// (node:56338) [MY_WARNING] Warning: Something happened!
// This is some additional information
const { emitWarning } = require('node:process');

// Emit a warning with a code and additional detail.
emitWarning('Something happened!', {
  code: 'MY_WARNING',
  detail: 'This is some additional information',
});
// Emits:
// (node:56338) [MY_WARNING] Warning: Something happened!
// This is some additional information

javascriptcopy
```

In this example, an `Error` object is generated internally by
`process.emitWarning()` and passed through to the
[`'warning'`](#event-warning) handler.

```
[ ] import process from 'node:process';

process.on('warning', (warning) => {
  console.warn(warning.name);    // 'Warning'
  console.warn(warning.message); // 'Something happened!'
  console.warn(warning.code);    // 'MY_WARNING'
  console.warn(warning.stack);   // Stack trace
  console.warn(warning.detail);  // 'This is some additional information'
});
process.on('warning', (warning) => {
  console.warn(warning.name);    // 'Warning'
  console.warn(warning.message); // 'Something happened!'
  console.warn(warning.code);    // 'MY_WARNING'
  console.warn(warning.stack);   // Stack trace
  console.warn(warning.detail);  // 'This is some additional information'
});

javascriptcopy
```

If `warning` is passed as an `Error` object, the `options` argument is ignored.

### `process.emitWarning(warning[, type[, code]][, ctor])`[#](#processemitwarningwarning-type-code-ctor)

Added in: v6.0.0

* `warning` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) The warning to emit.
* `type` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) When `warning` is a `String`, `type` is the name to use
  for the *type* of warning being emitted. **Default:** `'Warning'`.
* `code` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) A unique identifier for the warning instance being emitted.
* `ctor` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) When `warning` is a `String`, `ctor` is an optional
  function used to limit the generated stack trace. **Default:**
  `process.emitWarning`.

The `process.emitWarning()` method can be used to emit custom or application
specific process warnings. These can be listened for by adding a handler to the
[`'warning'`](#event-warning) event.

```
[ ] import { emitWarning } from 'node:process';

// Emit a warning using a string.
emitWarning('Something happened!');
// Emits: (node: 56338) Warning: Something happened!
const { emitWarning } = require('node:process');

// Emit a warning using a string.
emitWarning('Something happened!');
// Emits: (node: 56338) Warning: Something happened!

javascriptcopy
```

```
[ ] import { emitWarning } from 'node:process';

// Emit a warning using a string and a type.
emitWarning('Something Happened!', 'CustomWarning');
// Emits: (node:56338) CustomWarning: Something Happened!
const { emitWarning } = require('node:process');

// Emit a warning using a string and a type.
emitWarning('Something Happened!', 'CustomWarning');
// Emits: (node:56338) CustomWarning: Something Happened!

javascriptcopy
```

```
[ ] import { emitWarning } from 'node:process';

emitWarning('Something happened!', 'CustomWarning', 'WARN001');
// Emits: (node:56338) [WARN001] CustomWarning: Something happened!
const { emitWarning } = require('node:process');

process.emitWarning('Something happened!', 'CustomWarning', 'WARN001');
// Emits: (node:56338) [WARN001] CustomWarning: Something happened!

javascriptcopy
```

In each of the previous examples, an `Error` object is generated internally by
`process.emitWarning()` and passed through to the [`'warning'`](#event-warning)
handler.

```
[ ] import process from 'node:process';

process.on('warning', (warning) => {
  console.warn(warning.name);
  console.warn(warning.message);
  console.warn(warning.code);
  console.warn(warning.stack);
});
process.on('warning', (warning) => {
  console.warn(warning.name);
  console.warn(warning.message);
  console.warn(warning.code);
  console.warn(warning.stack);
});

javascriptcopy
```

If `warning` is passed as an `Error` object, it will be passed through to the
`'warning'` event handler unmodified (and the optional `type`,
`code` and `ctor` arguments will be ignored):

```
[ ] import { emitWarning } from 'node:process';

// Emit a warning using an Error object.
const myWarning = new Error('Something happened!');
// Use the Error name property to specify the type name
myWarning.name = 'CustomWarning';
myWarning.code = 'WARN001';

emitWarning(myWarning);
// Emits: (node:56338) [WARN001] CustomWarning: Something happened!
const { emitWarning } = require('node:process');

// Emit a warning using an Error object.
const myWarning = new Error('Something happened!');
// Use the Error name property to specify the type name
myWarning.name = 'CustomWarning';
myWarning.code = 'WARN001';

emitWarning(myWarning);
// Emits: (node:56338) [WARN001] CustomWarning: Something happened!

javascriptcopy
```

A `TypeError` is thrown if `warning` is anything other than a string or `Error`
object.

While process warnings use `Error` objects, the process warning
mechanism is **not** a replacement for normal error handling mechanisms.

The following additional handling is implemented if the warning `type` is
`'DeprecationWarning'`:

* If the `--throw-deprecation` command-line flag is used, the deprecation
  warning is thrown as an exception rather than being emitted as an event.
* If the `--no-deprecation` command-line flag is used, the deprecation
  warning is suppressed.
* If the `--trace-deprecation` command-line flag is used, the deprecation
  warning is printed to `stderr` along with the full stack trace.

#### Avoiding duplicate warnings[#](#avoiding-duplicate-warnings)

As a best practice, warnings should be emitted only once per process. To do
so, place the `emitWarning()` behind a boolean.

```
[ ] import { emitWarning } from 'node:process';

function emitMyWarning() {
  if (!emitMyWarning.warned) {
    emitMyWarning.warned = true;
    emitWarning('Only warn once!');
  }
}
emitMyWarning();
// Emits: (node: 56339) Warning: Only warn once!
emitMyWarning();
// Emits nothing
const { emitWarning } = require('node:process');

function emitMyWarning() {
  if (!emitMyWarning.warned) {
    emitMyWarning.warned = true;
    emitWarning('Only warn once!');
  }
}
emitMyWarning();
// Emits: (node: 56339) Warning: Only warn once!
emitMyWarning();
// Emits nothing

javascriptcopy
```

### `process.env`[#](#processenv)

Added in: v0.1.27History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v11.14.0 Worker threads will now use a copy of the parent thread's `process.env` by default, configurable through the `env` option of the `Worker` constructor.| v10.0.0 Implicit conversion of variable value to string is deprecated. | | | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.env` property returns an object containing the user environment.
See [`environ(7)`](http://man7.org/linux/man-pages/man7/environ.7.html).

An example of this object looks like:

```
{
  "TERM": "xterm-256color",
  "SHELL": "/usr/local/bin/bash",
  "USER": "maciej",
  "PATH": "~/.bin/:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin",
  "PWD": "/Users/maciej",
  "EDITOR": "vim",
  "SHLVL": "1",
  "HOME": "/Users/maciej",
  "LOGNAME": "maciej",
  "_": "/usr/local/bin/node"
}

jsoncopy
```

It is possible to modify this object, but such modifications will not be
reflected outside the Node.js process, or (unless explicitly requested)
to other [`Worker`](worker_threads.html#class-worker) threads.
In other words, the following example would not work:

```
node -e 'process.env.foo = "bar"' && echo $foo

bashcopy
```

While the following will:

```
[ ] import { env } from 'node:process';

env.foo = 'bar';
console.log(env.foo);
const { env } = require('node:process');

env.foo = 'bar';
console.log(env.foo);

javascriptcopy
```

Assigning a property on `process.env` will implicitly convert the value
to a string. **This behavior is deprecated.** Future versions of Node.js may
throw an error when the value is not a string, number, or boolean.

```
[ ] import { env } from 'node:process';

env.test = null;
console.log(env.test);
// => 'null'
env.test = undefined;
console.log(env.test);
// => 'undefined'
const { env } = require('node:process');

env.test = null;
console.log(env.test);
// => 'null'
env.test = undefined;
console.log(env.test);
// => 'undefined'

javascriptcopy
```

Use `delete` to delete a property from `process.env`.

```
[ ] import { env } from 'node:process';

env.TEST = 1;
delete env.TEST;
console.log(env.TEST);
// => undefined
const { env } = require('node:process');

env.TEST = 1;
delete env.TEST;
console.log(env.TEST);
// => undefined

javascriptcopy
```

On Windows operating systems, environment variables are case-insensitive.

```
[ ] import { env } from 'node:process';

env.TEST = 1;
console.log(env.test);
// => 1
const { env } = require('node:process');

env.TEST = 1;
console.log(env.test);
// => 1

javascriptcopy
```

Unless explicitly specified when creating a [`Worker`](worker_threads.html#class-worker) instance,
each [`Worker`](worker_threads.html#class-worker) thread has its own copy of `process.env`, based on its
parent thread's `process.env`, or whatever was specified as the `env` option
to the [`Worker`](worker_threads.html#class-worker) constructor. Changes to `process.env` will not be visible
across [`Worker`](worker_threads.html#class-worker) threads, and only the main thread can make changes that
are visible to the operating system or to native add-ons. On Windows, a copy of
`process.env` on a [`Worker`](worker_threads.html#class-worker) instance operates in a case-sensitive manner
unlike the main thread.

### `process.execArgv`[#](#processexecargv)

Added in: v0.7.7

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)[]

The `process.execArgv` property returns the set of Node.js-specific command-line
options passed when the Node.js process was launched. These options do not
appear in the array returned by the [`process.argv`](#processargv) property, and do not
include the Node.js executable, the name of the script, or any options following
the script name. These options are useful in order to spawn child processes with
the same execution environment as the parent.

```
node --icu-data-dir=./foo --require ./bar.js script.js --version

bashcopy
```

Results in `process.execArgv`:

```
["--icu-data-dir=./foo", "--require", "./bar.js"]

jsoncopy
```

And `process.argv`:

```
["/usr/local/bin/node", "script.js", "--version"]

jsoncopy
```

Refer to [`Worker` constructor](worker_threads.html#new-workerfilename-options) for the detailed behavior of worker
threads with this property.

### `process.execPath`[#](#processexecpath)

Added in: v0.1.100

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.execPath` property returns the absolute pathname of the executable
that started the Node.js process. Symbolic links, if any, are resolved.

```
"/usr/local/bin/node"

jsoncopy
```

### `process.execve(file[, args[, env]])`[#](#processexecvefile-args-env)

Added in: v23.11.0, v22.15.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v26.1.0 A failed `execve(2)` system call now throws an exception instead of aborting the process. Native `AtExit` callbacks registered via the embedder API are no longer invoked before the `execve(2)` call. | | | |

Stability: 1 - Experimental

* `file` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) The name or path of the executable file to run.
* `args` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)[] List of string arguments. No argument can contain a null-byte (`\u0000`).
* `env` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) Environment key-value pairs.
  No key or value can contain a null-byte (`\u0000`).
  **Default:** `process.env`.

Replaces the current process with a new process.

This is achieved by using the `execve` POSIX function and therefore no memory or other
resources from the current process are preserved, except for the standard input,
standard output and standard error file descriptor.

On success, all other resources are discarded by the system when the
processes are swapped, without triggering any exit or close events, without
running any JavaScript cleanup handler (for example `process.on('exit')`),
and without invoking native `AtExit` callbacks registered through the
embedder API. Callers that need to run cleanup logic should do so before
calling `process.execve()`.

This function does not return on success. If the underlying `execve(2)`
system call fails, an `Error` is thrown whose `code` property is set to the
corresponding `errno` string (for example, `'ENOENT'` when `file` does not
exist), with `syscall` set to `'execve'` and `path` set to `file`. When
`execve(2)` fails the current process continues to run with its state
unchanged, so a caller may handle the error and take another action.

This function is not available on Windows or IBM i.

### `process.exit([code])`[#](#processexitcode)

Added in: v0.1.13History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v20.0.0 Only accepts a code of type number, or of type string if it represents an integer. | | | |

* `code` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<null>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#null_type) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type) The exit code. For string type, only
  integer strings (e.g.,'1') are allowed. **Default:** `0`.

The `process.exit()` method instructs Node.js to terminate the process
synchronously with an exit status of `code`. If `code` is omitted, exit uses
either the 'success' code `0` or the value of `process.exitCode` if it has been
set. Node.js will not terminate until all the [`'exit'`](#event-exit) event listeners are
called.

To exit with a 'failure' code:

```
[ ] import { exit } from 'node:process';

exit(1);
const { exit } = require('node:process');

exit(1);

javascriptcopy
```

The shell that executed Node.js should see the exit code as `1`.

Calling `process.exit()` will force the process to exit as quickly as possible
even if there are still asynchronous operations pending that have not yet
completed fully, including I/O operations to `process.stdout` and
`process.stderr`.

In most situations, it is not actually necessary to call `process.exit()`
explicitly. The Node.js process will exit on its own *if there is no additional
work pending* in the event loop. The `process.exitCode` property can be set to
tell the process which exit code to use when the process exits gracefully.

For instance, the following example illustrates a *misuse* of the
`process.exit()` method that could lead to data printed to stdout being
truncated and lost:

```
[ ] import { exit } from 'node:process';

// This is an example of what *not* to do:
if (someConditionNotMet()) {
  printUsageToStdout();
  exit(1);
}
const { exit } = require('node:process');

// This is an example of what *not* to do:
if (someConditionNotMet()) {
  printUsageToStdout();
  exit(1);
}

javascriptcopy
```

The reason this is problematic is because writes to `process.stdout` in Node.js
are sometimes *asynchronous* and may occur over multiple ticks of the Node.js
event loop. Calling `process.exit()`, however, forces the process to exit
*before* those additional writes to `stdout` can be performed.

Rather than calling `process.exit()` directly, the code *should* set the
`process.exitCode` and allow the process to exit naturally by avoiding
scheduling any additional work for the event loop:

```
[ ] import process from 'node:process';

// How to properly set the exit code while letting
// the process exit gracefully.
if (someConditionNotMet()) {
  printUsageToStdout();
  process.exitCode = 1;
}
// How to properly set the exit code while letting
// the process exit gracefully.
if (someConditionNotMet()) {
  printUsageToStdout();
  process.exitCode = 1;
}

javascriptcopy
```

If it is necessary to terminate the Node.js process due to an error condition,
throwing an *uncaught* error and allowing the process to terminate accordingly
is safer than calling `process.exit()`.

In [`Worker`](worker_threads.html#class-worker) threads, this function stops the current thread rather
than the current process.

### `process.exitCode`[#](#processexitcode-1)

Added in: v0.11.8History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v20.0.0 Only accepts a code of type number, or of type string if it represents an integer. | | | |

* Type: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<null>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#null_type) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type) The exit code. For string type, only
  integer strings (e.g.,'1') are allowed. **Default:** `undefined`.

A number which will be the process exit code, when the process either
exits gracefully, or is exited via [`process.exit()`](#processexitcode) without specifying
a code.

The value of `process.exitCode` can be updated by either assigning a value to
`process.exitCode` or by passing an argument to [`process.exit()`](#processexitcode):

```
$ node -e 'process.exitCode = 9'; echo $?
9
$ node -e 'process.exit(42)'; echo $?
42
$ node -e 'process.exitCode = 9; process.exit(42)'; echo $?
42

consolecopy
```

The value can also be set implicitly by Node.js when unrecoverable errors occur (e.g.
such as the encountering of an unsettled top-level await). However explicit
manipulations of the exit code always take precedence over implicit ones:

```
$ node --input-type=module -e 'await new Promise(() => {})'; echo $?
13
$ node --input-type=module -e 'process.exitCode = 9; await new Promise(() => {})'; echo $?
9

consolecopy
```

### `process.features.cached_builtins`[#](#processfeaturescached_builtins)

Added in: v12.0.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build is caching builtin modules.

### `process.features.debug`[#](#processfeaturesdebug)

Added in: v0.5.5

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build is a debug build.

### `process.features.inspector`[#](#processfeaturesinspector)

Added in: v11.10.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes the inspector.

### `process.features.ipv6`[#](#processfeaturesipv6)

Added in: v0.5.3Deprecated in: v23.4.0, v22.13.0

Stability: 0 - Deprecated. This property is always true, and any checks based on it are
redundant.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for IPv6.

Since all Node.js builds have IPv6 support, this value is always `true`.

### `process.features.require_module`[#](#processfeaturesrequire_module)

Added in: v23.0.0, v22.10.0, v20.19.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build supports
[loading ECMAScript modules using `require()`](modules.html#loading-ecmascript-modules-using-require).

### `process.features.tls`[#](#processfeaturestls)

Added in: v0.5.3

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for TLS.

### `process.features.tls_alpn`[#](#processfeaturestls_alpn)

Added in: v4.8.0Deprecated in: v23.4.0, v22.13.0

Stability: 0 - Deprecated. Use `process.features.tls` instead.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for ALPN in TLS.

In Node.js 11.0.0 and later versions, the OpenSSL dependencies feature unconditional ALPN support.
This value is therefore identical to that of `process.features.tls`.

### `process.features.tls_ocsp`[#](#processfeaturestls_ocsp)

Added in: v0.11.13Deprecated in: v23.4.0, v22.13.0

Stability: 0 - Deprecated. Use `process.features.tls` instead.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for OCSP in TLS.

In Node.js 11.0.0 and later versions, the OpenSSL dependencies feature unconditional OCSP support.
This value is therefore identical to that of `process.features.tls`.

### `process.features.tls_sni`[#](#processfeaturestls_sni)

Added in: v0.5.3Deprecated in: v23.4.0, v22.13.0

Stability: 0 - Deprecated. Use `process.features.tls` instead.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for SNI in TLS.

In Node.js 11.0.0 and later versions, the OpenSSL dependencies feature unconditional SNI support.
This value is therefore identical to that of `process.features.tls`.

### `process.features.typescript`[#](#processfeaturestypescript)

Added in: v23.0.0, v22.10.0History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v26.0.0 Removed `transform` value.| v25.2.0, v24.12.0 Type stripping is now stable. | | | | | |

Stability: 1.2 - Release candidate

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

A value that is `"strip"` by default, and `false` if
Node.js is run with `--no-strip-types`.

### `process.features.uv`[#](#processfeaturesuv)

Added in: v0.5.3Deprecated in: v23.4.0, v22.13.0

Stability: 0 - Deprecated. This property is always true, and any checks based on it are
redundant.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

A boolean value that is `true` if the current Node.js build includes support for libuv.

Since it's not possible to build Node.js without libuv, this value is always `true`.

### `process.finalization.register(ref, callback)`[#](#processfinalizationregisterref-callback)

Added in: v22.5.0

Stability: 1.1 - Active Development

* `ref` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The reference to the resource that is being tracked.
* `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The callback function to be called when the resource
  is finalized.
  + `ref` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The reference to the resource that is being tracked.
  + `event` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) The event that triggered the finalization. Defaults to 'exit'.

This function registers a callback to be called when the process emits the `exit`
event if the `ref` object was not garbage collected. If the object `ref` was garbage collected
before the `exit` event is emitted, the callback will be removed from the finalization registry,
and it will not be called on process exit.

Inside the callback you can release the resources allocated by the `ref` object.
Be aware that all limitations applied to the `beforeExit` event are also applied to the `callback` function,
this means that there is a possibility that the callback will not be called under special circumstances.

The idea of ​​this function is to help you free up resources when the starts process exiting,
but also let the object be garbage collected if it is no longer being used.

Eg: you can register an object that contains a buffer, you want to make sure that buffer is released
when the process exit, but if the object is garbage collected before the process exit, we no longer
need to release the buffer, so in this case we just remove the callback from the finalization registry.

```
[x] const { finalization } = require('node:process');

// Please make sure that the function passed to finalization.register()
// does not create a closure around unnecessary objects.
function onFinalize(obj, event) {
  // You can do whatever you want with the object
  obj.dispose();
}

function setup() {
  // This object can be safely garbage collected,
  // and the resulting shutdown function will not be called.
  // There are no leaks.
  const myDisposableObject = {
    dispose() {
      // Free your resources synchronously
    },
  };

  finalization.register(myDisposableObject, onFinalize);
}

setup();
import { finalization } from 'node:process';

// Please make sure that the function passed to finalization.register()
// does not create a closure around unnecessary objects.
function onFinalize(obj, event) {
  // You can do whatever you want with the object
  obj.dispose();
}

function setup() {
  // This object can be safely garbage collected,
  // and the resulting shutdown function will not be called.
  // There are no leaks.
  const myDisposableObject = {
    dispose() {
      // Free your resources synchronously
    },
  };

  finalization.register(myDisposableObject, onFinalize);
}

setup();

javascriptcopy
```

The code above relies on the following assumptions:

* arrow functions are avoided
* regular functions are recommended to be within the global context (root)

Regular functions *could* reference the context where the `obj` lives, making the `obj` not garbage collectible.

Arrow functions will hold the previous context. Consider, for example:

```
class Test {
  constructor() {
    finalization.register(this, (ref) => ref.dispose());

    // Even something like this is highly discouraged
    // finalization.register(this, () => this.dispose());
  }
  dispose() {}
}

jscopy
```

It is very unlikely (not impossible) that this object will be garbage collected,
but if it is not, `dispose` will be called when `process.exit` is called.

Be careful and avoid relying on this feature for the disposal of critical resources,
as it is not guaranteed that the callback will be called under all circumstances.

### `process.finalization.registerBeforeExit(ref, callback)`[#](#processfinalizationregisterbeforeexitref-callback)

Added in: v22.5.0

Stability: 1.1 - Active Development

* `ref` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The reference
  to the resource that is being tracked.
* `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The callback function to be called when the resource
  is finalized.
  + `ref` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The reference to the resource that is being tracked.
  + `event` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) The event that triggered the finalization. Defaults to 'beforeExit'.

This function behaves exactly like the `register`, except that the callback will be called
when the process emits the `beforeExit` event if `ref` object was not garbage collected.

Be aware that all limitations applied to the `beforeExit` event are also applied to the `callback` function,
this means that there is a possibility that the callback will not be called under special circumstances.

### `process.finalization.unregister(ref)`[#](#processfinalizationunregisterref)

Added in: v22.5.0

Stability: 1.1 - Active Development

* `ref` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) The reference
  to the resource that was registered previously.

This function remove the register of the object from the finalization
registry, so the callback will not be called anymore.

```
[x] const { finalization } = require('node:process');

// Please make sure that the function passed to finalization.register()
// does not create a closure around unnecessary objects.
function onFinalize(obj, event) {
  // You can do whatever you want with the object
  obj.dispose();
}

function setup() {
  // This object can be safely garbage collected,
  // and the resulting shutdown function will not be called.
  // There are no leaks.
  const myDisposableObject = {
    dispose() {
      // Free your resources synchronously
    },
  };

  finalization.register(myDisposableObject, onFinalize);

  // Do something

  myDisposableObject.dispose();
  finalization.unregister(myDisposableObject);
}

setup();
import { finalization } from 'node:process';

// Please make sure that the function passed to finalization.register()
// does not create a closure around unnecessary objects.
function onFinalize(obj, event) {
  // You can do whatever you want with the object
  obj.dispose();
}

function setup() {
  // This object can be safely garbage collected,
  // and the resulting shutdown function will not be called.
  // There are no leaks.
  const myDisposableObject = {
    dispose() {
      // Free your resources synchronously
    },
  };

  // Please make sure that the function passed to finalization.register()
  // does not create a closure around unnecessary objects.
  function onFinalize(obj, event) {
    // You can do whatever you want with the object
    obj.dispose();
  }

  finalization.register(myDisposableObject, onFinalize);

  // Do something

  myDisposableObject.dispose();
  finalization.unregister(myDisposableObject);
}

setup();

javascriptcopy
```

### `process.getActiveResourcesInfo()`[#](#processgetactiveresourcesinfo)

Added in: v17.3.0, v16.14.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v24.0.0, v22.16.0 Change stability index for this feature from Experimental to Stable. | | | |

* Returns: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)[]

The `process.getActiveResourcesInfo()` method returns an array of strings
containing the types of the active resources that are currently keeping the
event loop alive.

```
[ ] import { getActiveResourcesInfo } from 'node:process';
import { setTimeout } from 'node:timers';

console.log('Before:', getActiveResourcesInfo());
setTimeout(() => {}, 1000);
console.log('After:', getActiveResourcesInfo());
// Prints:
//   Before: [ 'CloseReq', 'TTYWrap', 'TTYWrap', 'TTYWrap' ]
//   After: [ 'CloseReq', 'TTYWrap', 'TTYWrap', 'TTYWrap', 'Timeout' ]
const { getActiveResourcesInfo } = require('node:process');
const { setTimeout } = require('node:timers');

console.log('Before:', getActiveResourcesInfo());
setTimeout(() => {}, 1000);
console.log('After:', getActiveResourcesInfo());
// Prints:
//   Before: [ 'TTYWrap', 'TTYWrap', 'TTYWrap' ]
//   After: [ 'TTYWrap', 'TTYWrap', 'TTYWrap', 'Timeout' ]

javascriptcopy
```

### `process.getBuiltinModule(id)`[#](#processgetbuiltinmoduleid)

Added in: v22.3.0, v20.16.0

* `id` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) ID of the built-in module being requested.
* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type)

`process.getBuiltinModule(id)` provides a way to load built-in modules
in a globally available function. ES Modules that need to support
other environments can use it to conditionally load a Node.js built-in
when it is run in Node.js, without having to deal with the resolution
error that can be thrown by `import` in a non-Node.js environment or
having to use dynamic `import()` which either turns the module into
an asynchronous module, or turns a synchronous API into an asynchronous one.

```
if (globalThis.process?.getBuiltinModule) {
  // Run in Node.js, use the Node.js fs module.
  const fs = globalThis.process.getBuiltinModule('fs');
  // If `require()` is needed to load user-modules, use createRequire()
  const module = globalThis.process.getBuiltinModule('module');
  const require = module.createRequire(import.meta.url);
  const foo = require('foo');
}

mjscopy
```

If `id` specifies a built-in module available in the current Node.js process,
`process.getBuiltinModule(id)` method returns the corresponding built-in
module. If `id` does not correspond to any built-in module, `undefined`
is returned.

`process.getBuiltinModule(id)` accepts built-in module IDs that are recognized
by [`module.isBuiltin(id)`](module.html#moduleisbuiltinmodulename). Some built-in modules must be loaded with the
`node:` prefix, see [built-in modules with mandatory `node:` prefix](modules.html#built-in-modules-with-mandatory-node-prefix).
The references returned by `process.getBuiltinModule(id)` always point to
the built-in module corresponding to `id` even if users modify
[`require.cache`](modules.html#requirecache) so that `require(id)` returns something else.

### `process.getegid()`[#](#processgetegid)

Added in: v2.0.0

The `process.getegid()` method returns the numerical effective group identity
of the Node.js process. (See [`getegid(2)`](http://man7.org/linux/man-pages/man2/getegid.2.html).)

```
[ ] import process from 'node:process';

if (process.getegid) {
  console.log(`Current gid: ${process.getegid()}`);
}
if (process.getegid) {
  console.log(`Current gid: ${process.getegid()}`);
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).

### `process.geteuid()`[#](#processgeteuid)

Added in: v2.0.0

* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.geteuid()` method returns the numerical effective user identity of
the process. (See [`geteuid(2)`](http://man7.org/linux/man-pages/man2/geteuid.2.html).)

```
[ ] import process from 'node:process';

if (process.geteuid) {
  console.log(`Current uid: ${process.geteuid()}`);
}
if (process.geteuid) {
  console.log(`Current uid: ${process.geteuid()}`);
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).

### `process.getgid()`[#](#processgetgid)

Added in: v0.1.31

* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.getgid()` method returns the numerical group identity of the
process. (See [`getgid(2)`](http://man7.org/linux/man-pages/man2/getgid.2.html).)

```
[ ] import process from 'node:process';

if (process.getgid) {
  console.log(`Current gid: ${process.getgid()}`);
}
if (process.getgid) {
  console.log(`Current gid: ${process.getgid()}`);
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).

### `process.getgroups()`[#](#processgetgroups)

Added in: v0.9.4

* Returns: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)[]

The `process.getgroups()` method returns an array with the supplementary group
IDs. POSIX leaves it unspecified if the effective group ID is included but
Node.js ensures it always is.

```
[ ] import process from 'node:process';

if (process.getgroups) {
  console.log(process.getgroups()); // [ 16, 21, 297 ]
}
if (process.getgroups) {
  console.log(process.getgroups()); // [ 16, 21, 297 ]
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).

### `process.getuid()`[#](#processgetuid)

Added in: v0.1.28

* Returns: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.getuid()` method returns the numeric user identity of the process.
(See [`getuid(2)`](http://man7.org/linux/man-pages/man2/getuid.2.html).)

```
[ ] import process from 'node:process';

if (process.getuid) {
  console.log(`Current uid: ${process.getuid()}`);
}
if (process.getuid) {
  console.log(`Current uid: ${process.getuid()}`);
}

javascriptcopy
```

This function not available on Windows.

### `process.hasUncaughtExceptionCaptureCallback()`[#](#processhasuncaughtexceptioncapturecallback)

Added in: v9.3.0

* Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

Indicates whether a callback has been set using
[`process.setUncaughtExceptionCaptureCallback()`](#processsetuncaughtexceptioncapturecallbackfn).

### `process.hrtime([time])`[#](#processhrtimetime)

Added in: v0.7.6

Stability: 3 - Legacy. Use [`process.hrtime.bigint()`](#processhrtimebigint) instead.

* `time` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)[] The result of a previous call to `process.hrtime()`
* Returns: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)[]

This is the legacy version of [`process.hrtime.bigint()`](#processhrtimebigint)
before `bigint` was introduced in JavaScript.

The `process.hrtime()` method returns the current high-resolution real time
in a `[seconds, nanoseconds]` tuple `Array`, where `nanoseconds` is the
remaining part of the real time that can't be represented in second precision.

`time` is an optional parameter that must be the result of a previous
`process.hrtime()` call to diff with the current time. If the parameter
passed in is not a tuple `Array`, a `TypeError` will be thrown. Passing in a
user-defined array instead of the result of a previous call to
`process.hrtime()` will lead to undefined behavior.

These times are relative to an arbitrary time in the
past, and not related to the time of day and therefore not subject to clock
drift. The primary use is for measuring performance between intervals:

```
[ ] import { hrtime } from 'node:process';

const NS_PER_SEC = 1e9;
const time = hrtime();
// [ 1800216, 25 ]

setTimeout(() => {
  const diff = hrtime(time);
  // [ 1, 552 ]

  console.log(`Benchmark took ${diff[0] * NS_PER_SEC + diff[1]} nanoseconds`);
  // Benchmark took 1000000552 nanoseconds
}, 1000);
const { hrtime } = require('node:process');

const NS_PER_SEC = 1e9;
const time = hrtime();
// [ 1800216, 25 ]

setTimeout(() => {
  const diff = hrtime(time);
  // [ 1, 552 ]

  console.log(`Benchmark took ${diff[0] * NS_PER_SEC + diff[1]} nanoseconds`);
  // Benchmark took 1000000552 nanoseconds
}, 1000);

javascriptcopy
```

### `process.hrtime.bigint()`[#](#processhrtimebigint)

Added in: v10.7.0

* Returns: [`<bigint>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#bigint_type)

The `bigint` version of the [`process.hrtime()`](#processhrtimetime) method returning the
current high-resolution real time in nanoseconds as a `bigint`.

Unlike [`process.hrtime()`](#processhrtimetime), it does not support an additional `time`
argument since the difference can just be computed directly
by subtraction of the two `bigint`s.

```
[ ] import { hrtime } from 'node:process';

const start = hrtime.bigint();
// 191051479007711n

setTimeout(() => {
  const end = hrtime.bigint();
  // 191052633396993n

  console.log(`Benchmark took ${end - start} nanoseconds`);
  // Benchmark took 1154389282 nanoseconds
}, 1000);
const { hrtime } = require('node:process');

const start = hrtime.bigint();
// 191051479007711n

setTimeout(() => {
  const end = hrtime.bigint();
  // 191052633396993n

  console.log(`Benchmark took ${end - start} nanoseconds`);
  // Benchmark took 1154389282 nanoseconds
}, 1000);

javascriptcopy
```

### `process.initgroups(user, extraGroup)`[#](#processinitgroupsuser-extragroup)

Added in: v0.9.4

* `user` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) The user name or numeric identifier.
* `extraGroup` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A group name or numeric identifier.

The `process.initgroups()` method reads the `/etc/group` file and initializes
the group access list, using all groups of which the user is a member. This is
a privileged operation that requires that the Node.js process either have `root`
access or the `CAP_SETGID` capability.

Use care when dropping privileges:

```
[ ] import { getgroups, initgroups, setgid } from 'node:process';

console.log(getgroups());         // [ 0 ]
initgroups('nodeuser', 1000);     // switch user
console.log(getgroups());         // [ 27, 30, 46, 1000, 0 ]
setgid(1000);                     // drop root gid
console.log(getgroups());         // [ 27, 30, 46, 1000 ]
const { getgroups, initgroups, setgid } = require('node:process');

console.log(getgroups());         // [ 0 ]
initgroups('nodeuser', 1000);     // switch user
console.log(getgroups());         // [ 27, 30, 46, 1000, 0 ]
setgid(1000);                     // drop root gid
console.log(getgroups());         // [ 27, 30, 46, 1000 ]

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.kill(pid[, signal])`[#](#processkillpid-signal)

Added in: v0.0.6

* `pid` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A process ID
* `signal` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) The signal to send, either as a string or number. **Default:** `'SIGTERM'`.

The `process.kill()` method sends the `signal` to the process identified by
`pid`.

Signal names are strings such as `'SIGINT'` or `'SIGHUP'`. See [Signal Events](#signal-events) and [`kill(2)`](http://man7.org/linux/man-pages/man2/kill.2.html) for more information.

This method will throw an error if the target `pid` does not exist. As a special
case, a signal of `0` can be used to test for the existence of a process.
Windows platforms will throw an error if the `pid` is used to kill a process
group.

Even though the name of this function is `process.kill()`, it is really just a
signal sender, like the `kill` system call. The signal sent may do something
other than kill the target process.

```
[ ] import process, { kill } from 'node:process';

process.on('SIGHUP', () => {
  console.log('Got SIGHUP signal.');
});

setTimeout(() => {
  console.log('Exiting.');
  process.exit(0);
}, 100);

kill(process.pid, 'SIGHUP');
process.on('SIGHUP', () => {
  console.log('Got SIGHUP signal.');
});

setTimeout(() => {
  console.log('Exiting.');
  process.exit(0);
}, 100);

process.kill(process.pid, 'SIGHUP');

javascriptcopy
```

When `SIGUSR1` is received by a Node.js process, Node.js will start the
debugger. See [Signal Events](#signal-events).

### `process.loadEnvFile(path)`[#](#processloadenvfilepath)

Added in: v21.7.0, v20.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v24.10.0, v22.21.0 This API is no longer experimental. | | | |

* `path` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<URL>`](url.html#the-whatwg-url-api) | [`<Buffer>`](buffer.html#class-buffer) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type). **Default:** `'./.env'`

Loads the `.env` file into `process.env`. Usage of `NODE_OPTIONS`
in the `.env` file will not have any effect on Node.js.

```
[x] const { loadEnvFile } = require('node:process');
loadEnvFile();
import { loadEnvFile } from 'node:process';
loadEnvFile();

javascriptcopy
```

### `process.mainModule`[#](#processmainmodule)

Added in: v0.1.17Deprecated in: v14.0.0

Stability: 0 - Deprecated: Use [`require.main`](modules.html#accessing-the-main-module) instead.

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.mainModule` property provides an alternative way of retrieving
[`require.main`](modules.html#accessing-the-main-module). The difference is that if the main module changes at
runtime, [`require.main`](modules.html#accessing-the-main-module) may still refer to the original main module in
modules that were required before the change occurred. Generally, it's
safe to assume that the two refer to the same module.

As with [`require.main`](modules.html#accessing-the-main-module), `process.mainModule` will be `undefined` if there
is no entry script.

### `process.memoryUsage()`[#](#processmemoryusage)

Added in: v0.1.16History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v13.9.0, v12.17.0 Added `arrayBuffers` to the returned object.| v7.2.0 Added `external` to the returned object. | | | | | |

* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
  + `rss` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `heapTotal` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `heapUsed` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `external` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `arrayBuffers` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

Returns an object describing the memory usage of the Node.js process measured in
bytes.

```
[ ] import { memoryUsage } from 'node:process';

console.log(memoryUsage());
// Prints:
// {
//  rss: 4935680,
//  heapTotal: 1826816,
//  heapUsed: 650472,
//  external: 49879,
//  arrayBuffers: 9386
// }
const { memoryUsage } = require('node:process');

console.log(memoryUsage());
// Prints:
// {
//  rss: 4935680,
//  heapTotal: 1826816,
//  heapUsed: 650472,
//  external: 49879,
//  arrayBuffers: 9386
// }

javascriptcopy
```

* `heapTotal` and `heapUsed` refer to V8's memory usage.
* `external` refers to the memory usage of C++ objects bound to JavaScript
  objects managed by V8.
* `rss`, Resident Set Size, is the amount of space occupied in the main
  memory device (that is a subset of the total allocated memory) for the
  process, including all C++ and JavaScript objects and code.
* `arrayBuffers` refers to memory allocated for `ArrayBuffer`s and
  `SharedArrayBuffer`s, including all Node.js [`Buffer`](buffer.html)s.
  This is also included in the `external` value. When Node.js is used as an
  embedded library, this value may be `0` because allocations for `ArrayBuffer`s
  may not be tracked in that case.

When using [`Worker`](worker_threads.html#class-worker) threads, `rss` will be a value that is valid for the
entire process, while the other fields will only refer to the current thread.

The `process.memoryUsage()` method iterates over each page to gather
information about memory usage which might be slow depending on the
program memory allocations.

#### A note on process memoryUsage[#](#a-note-on-process-memoryusage)

On Linux or other systems where glibc is commonly used, an application may have sustained
`rss` growth despite stable `heapTotal` due to fragmentation caused by the glibc `malloc`
implementation. See [nodejs/node#21973](https://github.com/nodejs/node/issues/21973) on how to switch to an alternative `malloc`
implementation to address the performance issue.

### `process.memoryUsage.rss()`[#](#processmemoryusagerss)

Added in: v15.6.0, v14.18.0

* Returns: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.memoryUsage.rss()` method returns an integer representing the
Resident Set Size (RSS) in bytes.

The Resident Set Size, is the amount of space occupied in the main
memory device (that is a subset of the total allocated memory) for the
process, including all C++ and JavaScript objects and code.

This is the same value as the `rss` property provided by `process.memoryUsage()`
but `process.memoryUsage.rss()` is faster.

```
[ ] import { memoryUsage } from 'node:process';

console.log(memoryUsage.rss());
// 35655680
const { memoryUsage } = require('node:process');

console.log(memoryUsage.rss());
// 35655680

javascriptcopy
```

### `process.nextTick(callback[, ...args])`[#](#processnexttickcallback-args)

Added in: v0.1.26History

|  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  |  |  | | --- | --- | --- | --- | --- | --- | | v22.7.0, v20.18.0 Changed stability to Legacy.|  |  |  |  | | --- | --- | --- | --- | | v18.0.0 Passing an invalid callback to the `callback` argument now throws `ERR_INVALID_ARG_TYPE` instead of `ERR_INVALID_CALLBACK`.| v1.8.1 Additional arguments after `callback` are now supported. | | | | | | | |

Stability: 3 - Legacy: Use [`queueMicrotask()`](globals.html#queuemicrotaskcallback) instead.

* `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function)
* `...args` [`<any>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#Data_types) Additional arguments to pass when invoking the `callback`

`process.nextTick()` adds `callback` to the "next tick queue". This queue is
fully drained after the current operation on the JavaScript stack runs to
completion and before the event loop is allowed to continue. It's possible to
create an infinite loop if one were to recursively call `process.nextTick()`.
See the [Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick#understanding-processnexttick) guide for more background.

```
[ ] import { nextTick } from 'node:process';

console.log('start');
nextTick(() => {
  console.log('nextTick callback');
});
console.log('scheduled');
// Output:
// start
// scheduled
// nextTick callback
const { nextTick } = require('node:process');

console.log('start');
nextTick(() => {
  console.log('nextTick callback');
});
console.log('scheduled');
// Output:
// start
// scheduled
// nextTick callback

javascriptcopy
```

This is important when developing APIs in order to give users the opportunity
to assign event handlers *after* an object has been constructed but before any
I/O has occurred:

```
[ ] import { nextTick } from 'node:process';

function MyThing(options) {
  this.setupOptions(options);

  nextTick(() => {
    this.startDoingStuff();
  });
}

const thing = new MyThing();
thing.getReadyForStuff();

// thing.startDoingStuff() gets called now, not before.
const { nextTick } = require('node:process');

function MyThing(options) {
  this.setupOptions(options);

  nextTick(() => {
    this.startDoingStuff();
  });
}

const thing = new MyThing();
thing.getReadyForStuff();

// thing.startDoingStuff() gets called now, not before.

javascriptcopy
```

It is very important for APIs to be either 100% synchronous or 100%
asynchronous. Consider this example:

```
// WARNING!  DO NOT USE!  BAD UNSAFE HAZARD!
function maybeSync(arg, cb) {
  if (arg) {
    cb();
    return;
  }

  fs.stat('file', cb);
}

jscopy
```

This API is hazardous because in the following case:

```
const maybeTrue = Math.random() > 0.5;

maybeSync(maybeTrue, () => {
  foo();
});

bar();

jscopy
```

It is not clear whether `foo()` or `bar()` will be called first.

The following approach is much better:

```
[ ] import { nextTick } from 'node:process';

function definitelyAsync(arg, cb) {
  if (arg) {
    nextTick(cb);
    return;
  }

  fs.stat('file', cb);
}
const { nextTick } = require('node:process');

function definitelyAsync(arg, cb) {
  if (arg) {
    nextTick(cb);
    return;
  }

  fs.stat('file', cb);
}

javascriptcopy
```

#### When to use `queueMicrotask()` vs. `process.nextTick()`[#](#when-to-use-queuemicrotask-vs-processnexttick)

The [`queueMicrotask()`](globals.html#queuemicrotaskcallback) API is an alternative to `process.nextTick()` that instead of using the
"next tick queue" defers execution of a function using the same microtask queue used to execute the
then, catch, and finally handlers of resolved promises.

Within Node.js, every time the "next tick queue" is drained, the microtask queue
is drained immediately after.

So in CJS modules `process.nextTick()` callbacks are always run before `queueMicrotask()` ones.
However since ESM modules are processed already as part of the microtask queue, there
`queueMicrotask()` callbacks are always executed before `process.nextTick()` ones since Node.js
is already in the process of draining the microtask queue.

```
[ ] import { nextTick } from 'node:process';

Promise.resolve().then(() => console.log('resolve'));
queueMicrotask(() => console.log('microtask'));
nextTick(() => console.log('nextTick'));
// Output:
// resolve
// microtask
// nextTick
const { nextTick } = require('node:process');

Promise.resolve().then(() => console.log('resolve'));
queueMicrotask(() => console.log('microtask'));
nextTick(() => console.log('nextTick'));
// Output:
// nextTick
// resolve
// microtask

javascriptcopy
```

For *most* userland use cases, the `queueMicrotask()` API provides a portable
and reliable mechanism for deferring execution that works across multiple
JavaScript platform environments and should be favored over `process.nextTick()`.
In simple scenarios, `queueMicrotask()` can be a drop-in replacement for
`process.nextTick()`.

```
console.log('start');
queueMicrotask(() => {
  console.log('microtask callback');
});
console.log('scheduled');
// Output:
// start
// scheduled
// microtask callback

jscopy
```

One note-worthy difference between the two APIs is that `process.nextTick()`
allows specifying additional values that will be passed as arguments to the
deferred function when it is called. Achieving the same result with
`queueMicrotask()` requires using either a closure or a bound function:

```
function deferred(a, b) {
  console.log('microtask', a + b);
}

console.log('start');
queueMicrotask(deferred.bind(undefined, 1, 2));
console.log('scheduled');
// Output:
// start
// scheduled
// microtask 3

jscopy
```

There are minor differences in the way errors raised from within the next tick
queue and microtask queue are handled. Errors thrown within a queued microtask
callback should be handled within the queued callback when possible. If they are
not, the `process.on('uncaughtException')` event handler can be used to capture
and handle the errors.

When in doubt, unless the specific capabilities of `process.nextTick()` are
needed, use `queueMicrotask()`.

### `process.noDeprecation`[#](#processnodeprecation)

Added in: v0.8.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The `process.noDeprecation` property indicates whether the `--no-deprecation`
flag is set on the current Node.js process. See the documentation for
the [`'warning'` event](#event-warning) and the
[`emitWarning()` method](#processemitwarningwarning-type-code-ctor) for more information about this
flag's behavior.

### `process.permission`[#](#processpermission)

Added in: v20.0.0

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

This API is available through the [`--permission`](cli.html#--permission) or
[`--permission-audit`](cli.html#--permission-audit) flags.

`process.permission` is an object whose methods are used to manage permissions
for the current process. Additional documentation is available in the
[Permission Model](permissions.html#permission-model).

#### `process.permission.has(scope[, reference])`[#](#processpermissionhasscope-reference)

Added in: v20.0.0

* `scope` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)
* `reference` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)
* Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

Verifies that the process is able to access the given scope and reference.
If no reference is provided, a global scope is assumed, for instance,
`process.permission.has('fs.read')` will check if the process has ALL
file system read permissions.

In audit mode ([`--permission-audit`](cli.html#--permission-audit)), this method still returns the actual
permission status, but denied operations will not throw `ERR_ACCESS_DENIED`.

The reference has a meaning based on the provided scope. For example,
the reference when the scope is File System means files and folders.

The available scopes are:

* `fs` - All File System
* `fs.read` - File System read operations
* `fs.write` - File System write operations
* `child` - Child process spawning operations
* `openssl.store` - Loading keys through OpenSSL STORE loaders
* `worker` - Worker thread spawning operation
* `ffi` - Foreign function interface operations

```
// Check if the process has permission to read the README file
process.permission.has('fs.read', './README.md');
// Check if the process has read permission operations
process.permission.has('fs.read');

jscopy
```

#### `process.permission.drop(scope[, reference])`[#](#processpermissiondropscope-reference)

Added in: v26.3.0

Stability: 1.1 - Active Development

* `scope` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)
* `reference` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

Drops the specified permission from the current process. This operation is
**irreversible** — once a permission is dropped, it cannot be restored through
any Node.js API.

In audit mode ([`--permission-audit`](cli.html#--permission-audit)), dropping a permission takes effect,
but since denied operations do not throw, the impact is limited to changing the
return value of `permission.has()`.

If no reference is provided, the entire scope is dropped. For example,
`process.permission.drop('fs.read')` will revoke ALL file system read
permissions.

When a reference is provided, only the permission for that specific resource
is dropped. For example, `process.permission.drop('fs.read', '/etc/myapp')`
will revoke read access to that directory while keeping other read
permissions intact.

**Important:** You can only drop the exact resource that was explicitly
granted. The reference passed to `drop()` must match the original grant:

* If a permission was granted using a wildcard (`*`), such as
  `--allow-fs-read=*`, individual paths cannot be dropped - only the entire
  scope can be dropped (by calling `drop()` without a reference).
* If a directory was granted (e.g. `--allow-fs-read=/my/folder`), you cannot
  drop access to individual files inside it. You must drop the same directory
  that was granted. Any remaining grants continue to apply.

The available scopes are the same as [`process.permission.has()`](#processpermissionhasscope-reference):

* `fs` - All File System (drops both read and write)
* `fs.read` - File System read operations
* `fs.write` - File System write operations
* `child` - Child process spawning operations
* `openssl.store` - Loading keys through OpenSSL STORE loaders
* `worker` - Worker thread spawning operation
* `net` - Network operations
* `inspector` - Inspector operations
* `wasi` - WASI operations
* `addon` - Native addon operations

```
const fs = require('node:fs');

// Read configuration during startup
const config = fs.readFileSync('/etc/myapp/config.json', 'utf8');

// Drop read access to the config directory after initialization
process.permission.drop('fs.read', '/etc/myapp');

// This will now throw ERR_ACCESS_DENIED
fs.readFileSync('/etc/myapp/config.json');

jscopy
```

### `process.pid`[#](#processpid)

Added in: v0.1.15

* Type: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.pid` property returns the PID of the process.

```
[ ] import { pid } from 'node:process';

console.log(`This process is pid ${pid}`);
const { pid } = require('node:process');

console.log(`This process is pid ${pid}`);

javascriptcopy
```

### `process.platform`[#](#processplatform)

Added in: v0.1.16

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.platform` property returns a string identifying the operating
system platform for which the Node.js binary was compiled.

Currently possible values are:

* `'aix'`
* `'darwin'`
* `'freebsd'`
* `'linux'`
* `'openbsd'`
* `'sunos'`
* `'win32'`

```
[ ] import { platform } from 'node:process';

console.log(`This platform is ${platform}`);
const { platform } = require('node:process');

console.log(`This platform is ${platform}`);

javascriptcopy
```

The value `'android'` may also be returned if Node.js is built on the
Android operating system. However, Android support in Node.js
[is experimental](https://github.com/nodejs/node/blob/HEAD/BUILDING.md#android).

### `process.ppid`[#](#processppid)

Added in: v9.2.0, v8.10.0, v6.13.0

* Type: [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.ppid` property returns the PID of the parent of the
current process.

```
[ ] import { ppid } from 'node:process';

console.log(`The parent process is pid ${ppid}`);
const { ppid } = require('node:process');

console.log(`The parent process is pid ${ppid}`);

javascriptcopy
```

### `process.ref(maybeRefable)`[#](#processrefmayberefable)

Added in: v23.6.0, v22.14.0

Stability: 1 - Experimental

* `maybeRefable` [`<any>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#Data_types) An object that may be "refable".

An object is "refable" if it implements the Node.js "Refable protocol".
Specifically, this means that the object implements the `Symbol.for('nodejs.ref')`
and `Symbol.for('nodejs.unref')` methods. "Ref'd" objects will keep the Node.js
event loop alive, while "unref'd" objects will not. Historically, this was
implemented by using `ref()` and `unref()` methods directly on the objects.
This pattern, however, is being deprecated in favor of the "Refable protocol"
in order to better support Web Platform API types whose APIs cannot be modified
to add `ref()` and `unref()` methods but still need to support that behavior.

### `process.release`[#](#processrelease)

Added in: v3.0.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v4.2.0 The `lts` property is now supported. | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.release` property returns an `Object` containing metadata related
to the current release, including URLs for the source tarball and headers-only
tarball.

`process.release` contains the following properties:

* `name` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) A value that will always be `'node'`.
* `sourceUrl` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) an absolute URL pointing to a *`.tar.gz`* file containing
  the source code of the current release.
* `headersUrl`[`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) an absolute URL pointing to a *`.tar.gz`* file containing
  only the source header files for the current release. This file is
  significantly smaller than the full source file and can be used for compiling
  Node.js native add-ons.
* `libUrl` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type) an absolute URL pointing to a *`node.lib`* file
  matching the architecture and version of the current release. This file is
  used for compiling Node.js native add-ons. *This property is only present on
  Windows builds of Node.js and will be missing on all other platforms.*
* `lts` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<undefined>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#undefined_type) a string label identifying the [LTS](https://github.com/nodejs/Release) label for this
  release. This property only exists for LTS releases and is `undefined` for all
  other release types, including *Current* releases. Valid values include the
  LTS Release code names (including those that are no longer supported).
  + `'Fermium'` for the 14.x LTS line beginning with 14.15.0.
  + `'Gallium'` for the 16.x LTS line beginning with 16.13.0.
  + `'Hydrogen'` for the 18.x LTS line beginning with 18.12.0.
    For other LTS Release code names, see [Node.js Changelog Archive](https://github.com/nodejs/node/blob/HEAD/doc/changelogs/CHANGELOG_ARCHIVE.md)

```
{
  "name": "node",
  "lts": "Hydrogen",
  "sourceUrl": "https://nodejs.org/download/release/v18.12.0/node-v18.12.0.tar.gz",
  "headersUrl": "https://nodejs.org/download/release/v18.12.0/node-v18.12.0-headers.tar.gz",
  "libUrl": "https://nodejs.org/download/release/v18.12.0/win-x64/node.lib"
}

jsoncopy
```

In custom builds from non-release versions of the source tree, only the
`name` property may be present. The additional properties should not be
relied upon to exist.

### `process.report`[#](#processreport)

Added in: v11.8.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

`process.report` is an object whose methods are used to generate diagnostic
reports for the current process. Additional documentation is available in the
[report documentation](report.html).

#### `process.report.compact`[#](#processreportcompact)

Added in: v13.12.0, v12.17.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

Write reports in a compact format, single-line JSON, more easily consumable
by log processing systems than the default multi-line format designed for
human consumption.

```
[ ] import { report } from 'node:process';

console.log(`Reports are compact? ${report.compact}`);
const { report } = require('node:process');

console.log(`Reports are compact? ${report.compact}`);

javascriptcopy
```

#### `process.report.directory`[#](#processreportdirectory)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

Directory where the report is written. The default value is the empty string,
indicating that reports are written to the current working directory of the
Node.js process.

```
[ ] import { report } from 'node:process';

console.log(`Report directory is ${report.directory}`);
const { report } = require('node:process');

console.log(`Report directory is ${report.directory}`);

javascriptcopy
```

#### `process.report.filename`[#](#processreportfilename)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

Filename where the report is written. If set to the empty string, the output
filename will be comprised of a timestamp, PID, and sequence number. The default
value is the empty string.

If the value of `process.report.filename` is set to `'stdout'` or `'stderr'`,
the report is written to the stdout or stderr of the process respectively.

```
[ ] import { report } from 'node:process';

console.log(`Report filename is ${report.filename}`);
const { report } = require('node:process');

console.log(`Report filename is ${report.filename}`);

javascriptcopy
```

#### `process.report.getReport([err])`[#](#processreportgetreporterr)

Added in: v11.8.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* `err` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) A custom error used for reporting the JavaScript stack.
* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

Returns a JavaScript Object representation of a diagnostic report for the
running process. The report's JavaScript stack trace is taken from `err`, if
present.

```
[ ] import { report } from 'node:process';
import util from 'node:util';

const data = report.getReport();
console.log(data.header.nodejsVersion);

// Similar to process.report.writeReport()
import fs from 'node:fs';
fs.writeFileSync('my-report.log', util.inspect(data), 'utf8');
const { report } = require('node:process');
const util = require('node:util');

const data = report.getReport();
console.log(data.header.nodejsVersion);

// Similar to process.report.writeReport()
const fs = require('node:fs');
fs.writeFileSync('my-report.log', util.inspect(data), 'utf8');

javascriptcopy
```

Additional documentation is available in the [report documentation](report.html).

#### `process.report.reportOnFatalError`[#](#processreportreportonfatalerror)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v15.0.0, v14.17.0 This API is no longer experimental. | | | |

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If `true`, a diagnostic report is generated on fatal errors, such as out of
memory errors or failed C++ assertions.

```
[ ] import { report } from 'node:process';

console.log(`Report on fatal error: ${report.reportOnFatalError}`);
const { report } = require('node:process');

console.log(`Report on fatal error: ${report.reportOnFatalError}`);

javascriptcopy
```

#### `process.report.reportOnSignal`[#](#processreportreportonsignal)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If `true`, a diagnostic report is generated when the process receives the
signal specified by `process.report.signal`.

```
[ ] import { report } from 'node:process';

console.log(`Report on signal: ${report.reportOnSignal}`);
const { report } = require('node:process');

console.log(`Report on signal: ${report.reportOnSignal}`);

javascriptcopy
```

#### `process.report.reportOnUncaughtException`[#](#processreportreportonuncaughtexception)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If `true`, a diagnostic report is generated on uncaught exception.

```
[ ] import { report } from 'node:process';

console.log(`Report on exception: ${report.reportOnUncaughtException}`);
const { report } = require('node:process');

console.log(`Report on exception: ${report.reportOnUncaughtException}`);

javascriptcopy
```

#### `process.report.excludeEnv`[#](#processreportexcludeenv)

Added in: v23.3.0, v22.13.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If `true`, a diagnostic report is generated without the environment variables.

#### `process.report.signal`[#](#processreportsignal)

Added in: v11.12.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The signal used to trigger the creation of a diagnostic report. Defaults to
`'SIGUSR2'`.

```
[ ] import { report } from 'node:process';

console.log(`Report signal: ${report.signal}`);
const { report } = require('node:process');

console.log(`Report signal: ${report.signal}`);

javascriptcopy
```

#### `process.report.writeReport([filename][, err])`[#](#processreportwritereportfilename-err)

Added in: v11.8.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v13.12.0, v12.17.0 This API is no longer experimental. | | | |

* `filename` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) Name of the file where the report is written. This
  should be a relative path, that will be appended to the directory specified in `process.report.directory`, or the current working directory of the Node.js
  process, if unspecified.
* `err` [`<Error>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error) A custom error used for reporting the JavaScript stack.
* Returns: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) Returns the filename of the generated report.

Writes a diagnostic report to a file. If `filename` is not provided, the default
filename includes the date, time, PID, and a sequence number. The report's
JavaScript stack trace is taken from `err`, if present.

If the value of `filename` is set to `'stdout'` or `'stderr'`, the report is
written to the stdout or stderr of the process respectively.

```
[ ] import { report } from 'node:process';

report.writeReport();
const { report } = require('node:process');

report.writeReport();

javascriptcopy
```

Additional documentation is available in the [report documentation](report.html).

### `process.resourceUsage()`[#](#processresourceusage)

Added in: v12.6.0

* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) the resource usage for the current process. All of these
  values come from the `uv_getrusage` call which returns
  a [`uv_rusage_t` struct](https://docs.libuv.org/en/v1.x/misc.html#c.uv_rusage_t).
  + `userCPUTime` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_utime` computed in microseconds.
    It is the same value as [`process.cpuUsage().user`](#processcpuusagepreviousvalue).
  + `systemCPUTime` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_stime` computed in microseconds.
    It is the same value as [`process.cpuUsage().system`](#processcpuusagepreviousvalue).
  + `maxRSS` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_maxrss` which is the maximum resident set
    size used in kibibytes (1024 bytes).
  + `sharedMemorySize` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_ixrss` but is not supported by
    any platform.
  + `unsharedDataSize` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_idrss` but is not supported by
    any platform.
  + `unsharedStackSize` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_isrss` but is not supported by
    any platform.
  + `minorPageFault` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_minflt` which is the number of
    minor page faults for the process, see
    [this article for more details](https://en.wikipedia.org/wiki/Page_fault#Minor).
  + `majorPageFault` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_majflt` which is the number of
    major page faults for the process, see
    [this article for more details](https://en.wikipedia.org/wiki/Page_fault#Major). This field is not
    supported on Windows.
  + `swappedOut` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_nswap` but is not supported by any
    platform.
  + `fsRead` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_inblock` which is the number of times the
    file system had to perform input.
  + `fsWrite` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_oublock` which is the number of times the
    file system had to perform output.
  + `ipcSent` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_msgsnd` but is not supported by any
    platform.
  + `ipcReceived` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_msgrcv` but is not supported by any
    platform.
  + `signalsCount` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_nsignals` but is not supported by any
    platform.
  + `voluntaryContextSwitches` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_nvcsw` which is the
    number of times a CPU context switch resulted due to a process voluntarily
    giving up the processor before its time slice was completed (usually to
    await availability of a resource). This field is not supported on Windows.
  + `involuntaryContextSwitches` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) maps to `ru_nivcsw` which is the
    number of times a CPU context switch resulted due to a higher priority
    process becoming runnable or because the current process exceeded its
    time slice. This field is not supported on Windows.

```
[ ] import { resourceUsage } from 'node:process';

console.log(resourceUsage());
/*
  Will output:
  {
    userCPUTime: 82872,
    systemCPUTime: 4143,
    maxRSS: 33164,
    sharedMemorySize: 0,
    unsharedDataSize: 0,
    unsharedStackSize: 0,
    minorPageFault: 2469,
    majorPageFault: 0,
    swappedOut: 0,
    fsRead: 0,
    fsWrite: 8,
    ipcSent: 0,
    ipcReceived: 0,
    signalsCount: 0,
    voluntaryContextSwitches: 79,
    involuntaryContextSwitches: 1
  }
*/
const { resourceUsage } = require('node:process');

console.log(resourceUsage());
/*
  Will output:
  {
    userCPUTime: 82872,
    systemCPUTime: 4143,
    maxRSS: 33164,
    sharedMemorySize: 0,
    unsharedDataSize: 0,
    unsharedStackSize: 0,
    minorPageFault: 2469,
    majorPageFault: 0,
    swappedOut: 0,
    fsRead: 0,
    fsWrite: 8,
    ipcSent: 0,
    ipcReceived: 0,
    signalsCount: 0,
    voluntaryContextSwitches: 79,
    involuntaryContextSwitches: 1
  }
*/

javascriptcopy
```

### `process.send(message[, sendHandle[, options]][, callback])`[#](#processsendmessage-sendhandle-options-callback)

Added in: v0.5.9

* `message` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
* `sendHandle` [`<net.Server>`](net.html#class-netserver) | [`<net.Socket>`](net.html#class-netsocket)
* `options` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) used to parameterize the sending of certain types of
  handles.`options` supports the following properties:
  + `keepOpen` [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) A value that can be used when passing instances of `net.Socket`. When `true`, the socket is kept open in the sending process.
    **Default:** `false`.
* `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function)
* Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

If Node.js is spawned with an IPC channel, the `process.send()` method can be
used to send messages to the parent process. Messages will be received as a
[`'message'`](child_process.html#event-message) event on the parent's [`ChildProcess`](child_process.html#class-childprocess) object.

If Node.js was not spawned with an IPC channel, `process.send` will be
`undefined`.

The message goes through serialization and parsing. The resulting message might
not be the same as what is originally sent.

### `process.setegid(id)`[#](#processsetegidid)

Added in: v2.0.0

* `id` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A group name or ID

The `process.setegid()` method sets the effective group identity of the process.
(See [`setegid(2)`](http://man7.org/linux/man-pages/man2/setegid.2.html).) The `id` can be passed as either a numeric ID or a group
name string. If a group name is specified, this method blocks while resolving
the associated a numeric ID.

```
[ ] import process from 'node:process';

if (process.getegid && process.setegid) {
  console.log(`Current gid: ${process.getegid()}`);
  try {
    process.setegid(501);
    console.log(`New gid: ${process.getegid()}`);
  } catch (err) {
    console.error(`Failed to set gid: ${err}`);
  }
}
if (process.getegid && process.setegid) {
  console.log(`Current gid: ${process.getegid()}`);
  try {
    process.setegid(501);
    console.log(`New gid: ${process.getegid()}`);
  } catch (err) {
    console.error(`Failed to set gid: ${err}`);
  }
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.seteuid(id)`[#](#processseteuidid)

Added in: v2.0.0

* `id` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A user name or ID

The `process.seteuid()` method sets the effective user identity of the process.
(See [`seteuid(2)`](http://man7.org/linux/man-pages/man2/seteuid.2.html).) The `id` can be passed as either a numeric ID or a username
string. If a username is specified, the method blocks while resolving the
associated numeric ID.

```
[ ] import process from 'node:process';

if (process.geteuid && process.seteuid) {
  console.log(`Current uid: ${process.geteuid()}`);
  try {
    process.seteuid(501);
    console.log(`New uid: ${process.geteuid()}`);
  } catch (err) {
    console.error(`Failed to set uid: ${err}`);
  }
}
if (process.geteuid && process.seteuid) {
  console.log(`Current uid: ${process.geteuid()}`);
  try {
    process.seteuid(501);
    console.log(`New uid: ${process.geteuid()}`);
  } catch (err) {
    console.error(`Failed to set uid: ${err}`);
  }
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.setgid(id)`[#](#processsetgidid)

Added in: v0.1.31

* `id` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) The group name or ID

The `process.setgid()` method sets the group identity of the process. (See
[`setgid(2)`](http://man7.org/linux/man-pages/man2/setgid.2.html).) The `id` can be passed as either a numeric ID or a group name
string. If a group name is specified, this method blocks while resolving the
associated numeric ID.

```
[ ] import process from 'node:process';

if (process.getgid && process.setgid) {
  console.log(`Current gid: ${process.getgid()}`);
  try {
    process.setgid(501);
    console.log(`New gid: ${process.getgid()}`);
  } catch (err) {
    console.error(`Failed to set gid: ${err}`);
  }
}
if (process.getgid && process.setgid) {
  console.log(`Current gid: ${process.getgid()}`);
  try {
    process.setgid(501);
    console.log(`New gid: ${process.getgid()}`);
  } catch (err) {
    console.error(`Failed to set gid: ${err}`);
  }
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.setgroups(groups)`[#](#processsetgroupsgroups)

Added in: v0.9.4

* `groups` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)[]

The `process.setgroups()` method sets the supplementary group IDs for the
Node.js process. This is a privileged operation that requires the Node.js
process to have `root` or the `CAP_SETGID` capability.

The `groups` array can contain numeric group IDs, group names, or both.

```
[ ] import process from 'node:process';

if (process.getgroups && process.setgroups) {
  try {
    process.setgroups([501]);
    console.log(process.getgroups()); // new groups
  } catch (err) {
    console.error(`Failed to set groups: ${err}`);
  }
}
if (process.getgroups && process.setgroups) {
  try {
    process.setgroups([501]);
    console.log(process.getgroups()); // new groups
  } catch (err) {
    console.error(`Failed to set groups: ${err}`);
  }
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.setuid(id)`[#](#processsetuidid)

Added in: v0.1.28

* `id` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.setuid(id)` method sets the user identity of the process. (See
[`setuid(2)`](http://man7.org/linux/man-pages/man2/setuid.2.html).) The `id` can be passed as either a numeric ID or a username string.
If a username is specified, the method blocks while resolving the associated
numeric ID.

```
[ ] import process from 'node:process';

if (process.getuid && process.setuid) {
  console.log(`Current uid: ${process.getuid()}`);
  try {
    process.setuid(501);
    console.log(`New uid: ${process.getuid()}`);
  } catch (err) {
    console.error(`Failed to set uid: ${err}`);
  }
}
if (process.getuid && process.setuid) {
  console.log(`Current uid: ${process.getuid()}`);
  try {
    process.setuid(501);
    console.log(`New uid: ${process.getuid()}`);
  } catch (err) {
    console.error(`Failed to set uid: ${err}`);
  }
}

javascriptcopy
```

This function is only available on POSIX platforms (i.e. not Windows or
Android).
This feature is not available in [`Worker`](worker_threads.html#class-worker) threads.

### `process.setSourceMapsEnabled(val)`[#](#processsetsourcemapsenabledval)

Added in: v16.6.0, v14.18.0

Stability: 1 - Experimental: Use [`module.setSourceMapsSupport()`](module.html#modulesetsourcemapssupportenabled-options) instead.

* `val` [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

This function enables or disables the [Source Map](https://tc39.es/ecma426/) support for
stack traces.

It provides same features as launching Node.js process with commandline options
`--enable-source-maps`.

Only source maps in JavaScript files that are loaded after source maps has been
enabled will be parsed and loaded.

This implies calling `module.setSourceMapsSupport()` with an option
`{ nodeModules: true, generatedCode: true }`.

### `process.setUncaughtExceptionCaptureCallback(fn)`[#](#processsetuncaughtexceptioncapturecallbackfn)

Added in: v9.3.0History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v25.9.0 Use `process.addUncaughtExceptionCaptureCallback()` to register multiple callbacks. | | | |

* `fn` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) | [`<null>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#null_type)

The `process.setUncaughtExceptionCaptureCallback()` function sets a function
that will be invoked when an uncaught exception occurs, which will receive the
exception value itself as its first argument.

If such a function is set, the [`'uncaughtException'`](#event-uncaughtexception) event will
not be emitted. If `--abort-on-uncaught-exception` was passed from the
command line or set through [`v8.setFlagsFromString()`](v8.html#v8setflagsfromstringflags), the process will
not abort. Actions configured to take place on exceptions such as report
generations will be affected too

To unset the capture function,
`process.setUncaughtExceptionCaptureCallback(null)` may be used. Calling this
method with a non-`null` argument while another capture function is set will
throw an error.

To register multiple callbacks that can coexist, use
[`process.addUncaughtExceptionCaptureCallback()`](#processadduncaughtexceptioncapturecallbackfn) instead.

### `process.sourceMapsEnabled`[#](#processsourcemapsenabled)

Added in: v20.7.0, v18.19.0

Stability: 1 - Experimental: Use [`module.getSourceMapsSupport()`](module.html#modulegetsourcemapssupport) instead.

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The `process.sourceMapsEnabled` property returns whether the
[Source Map](https://tc39.es/ecma426/) support for stack traces is enabled.

### `process.stderr`[#](#processstderr)

* Type: [`<Stream>`](stream.html#stream)

The `process.stderr` property returns a stream connected to
`stderr` (fd `2`). It is a [`net.Socket`](net.html#class-netsocket) (which is a [Duplex](stream.html#duplex-and-transform-streams)
stream) unless fd `2` refers to a file, in which case it is
a [Writable](stream.html#writable-streams) stream.

`process.stderr` differs from other Node.js streams in important ways. See
[note on process I/O](#a-note-on-process-io) for more information.

#### `process.stderr.fd`[#](#processstderrfd)

* Type: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

This property refers to the value of underlying file descriptor of
`process.stderr`. The value is fixed at `2`. In [`Worker`](worker_threads.html#class-worker) threads,
this field does not exist.

### `process.stdin`[#](#processstdin)

* Type: [`<Stream>`](stream.html#stream)

The `process.stdin` property returns a stream connected to
`stdin` (fd `0`). It is a [`net.Socket`](net.html#class-netsocket) (which is a [Duplex](stream.html#duplex-and-transform-streams)
stream) unless fd `0` refers to a file, in which case it is
a [Readable](stream.html#readable-streams) stream.

For details of how to read from `stdin` see [`readable.read()`](stream.html#readablereadsize).

As a [Duplex](stream.html#duplex-and-transform-streams) stream, `process.stdin` can also be used in "old" mode that
is compatible with scripts written for Node.js prior to v0.10.
For more information see [Stream compatibility](stream.html#compatibility-with-older-nodejs-versions).

In "old" streams mode the `stdin` stream is paused by default, so one
must call `process.stdin.resume()` to read from it. Note also that calling
`process.stdin.resume()` itself would switch stream to "old" mode.

#### `process.stdin.fd`[#](#processstdinfd)

* Type: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

This property refers to the value of underlying file descriptor of
`process.stdin`. The value is fixed at `0`. In [`Worker`](worker_threads.html#class-worker) threads,
this field does not exist.

### `process.stdout`[#](#processstdout)

* Type: [`<Stream>`](stream.html#stream)

The `process.stdout` property returns a stream connected to
`stdout` (fd `1`). It is a [`net.Socket`](net.html#class-netsocket) (which is a [Duplex](stream.html#duplex-and-transform-streams)
stream) unless fd `1` refers to a file, in which case it is
a [Writable](stream.html#writable-streams) stream.

For example, to copy `process.stdin` to `process.stdout`:

```
[ ] import { stdin, stdout } from 'node:process';

stdin.pipe(stdout);
const { stdin, stdout } = require('node:process');

stdin.pipe(stdout);

javascriptcopy
```

`process.stdout` differs from other Node.js streams in important ways. See
[note on process I/O](#a-note-on-process-io) for more information.

#### `process.stdout.fd`[#](#processstdoutfd)

* Type: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

This property refers to the value of underlying file descriptor of
`process.stdout`. The value is fixed at `1`. In [`Worker`](worker_threads.html#class-worker) threads,
this field does not exist.

#### A note on process I/O[#](#a-note-on-process-io)

`process.stdout` and `process.stderr` differ from other Node.js streams in
important ways:

1. They are used internally by [`console.log()`](console.html#consolelogdata-args) and [`console.error()`](console.html#consoleerrordata-args),
   respectively.
2. Writes may be synchronous depending on what the stream is connected to
   and whether the system is Windows or POSIX:
   * Files: *synchronous* on Windows and POSIX
   * TTYs (Terminals): *asynchronous* on Windows, *synchronous* on POSIX
   * Pipes (and sockets): *synchronous* on Windows, *asynchronous* on POSIX

These behaviors are partly for historical reasons, as changing them would
create backward incompatibility, but they are also expected by some users.

Synchronous writes avoid problems such as output written with `console.log()` or
`console.error()` being unexpectedly interleaved, or not written at all if
`process.exit()` is called before an asynchronous write completes. See
[`process.exit()`](#processexitcode) for more information.

***Warning***: Synchronous writes block the event loop until the write has
completed. This can be near instantaneous in the case of output to a file, but
under high system load, pipes that are not being read at the receiving end, or
with slow terminals or file systems, it's possible for the event loop to be
blocked often enough and long enough to have severe negative performance
impacts. This may not be a problem when writing to an interactive terminal
session, but consider this particularly careful when doing production logging to
the process output streams.

To check if a stream is connected to a [TTY](tty.html#tty) context, check the `isTTY`
property.

For instance:

```
$ node -p "Boolean(process.stdin.isTTY)"
true
$ echo "foo" | node -p "Boolean(process.stdin.isTTY)"
false
$ node -p "Boolean(process.stdout.isTTY)"
true
$ node -p "Boolean(process.stdout.isTTY)" | cat
false

consolecopy
```

See the [TTY](tty.html#tty) documentation for more information.

### `process.throwDeprecation`[#](#processthrowdeprecation)

Added in: v0.9.12

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The initial value of `process.throwDeprecation` indicates whether the
`--throw-deprecation` flag is set on the current Node.js process.
`process.throwDeprecation` is mutable, so whether or not deprecation
warnings result in errors may be altered at runtime. See the
documentation for the [`'warning'` event](#event-warning) and the
[`emitWarning()` method](#processemitwarningwarning-type-code-ctor) for more information.

```
$ node --throw-deprecation -p "process.throwDeprecation"
true
$ node -p "process.throwDeprecation"
undefined
$ node
> process.emitWarning('test', 'DeprecationWarning');
undefined
> (node:26598) DeprecationWarning: test
> process.throwDeprecation = true;
true
> process.emitWarning('test', 'DeprecationWarning');
Thrown:
[DeprecationWarning: test] { name: 'DeprecationWarning' }

consolecopy
```

### `process.threadCpuUsage([previousValue])`[#](#processthreadcpuusagepreviousvalue)

Added in: v23.9.0, v22.19.0

* `previousValue` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) A previous return value from calling `process.threadCpuUsage()`
* Returns: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)
  + `user` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  + `system` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.threadCpuUsage()` method returns the user and system CPU time usage of
the current worker thread, in an object with properties `user` and `system`, whose
values are microsecond values (millionth of a second).

The result of a previous call to `process.threadCpuUsage()` can be passed as the
argument to the function, to get a diff reading.

### `process.title`[#](#processtitle)

Added in: v0.1.104

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.title` property returns the current process title (i.e. returns
the current value of `ps`). Assigning a new value to `process.title` modifies
the current value of `ps`.

When a new value is assigned, different platforms will impose different maximum
length restrictions on the title. Usually such restrictions are quite limited.
For instance, on Linux and macOS, `process.title` is limited to the size of the
binary name plus the length of the command-line arguments because setting the
`process.title` overwrites the `argv` memory of the process. Node.js 0.8
allowed for longer process title strings by also overwriting the `environ`
memory but that was potentially insecure and confusing in some (rather obscure)
cases.

Assigning a value to `process.title` might not result in an accurate label
within process manager applications such as macOS Activity Monitor or Windows
Services Manager.

### `process.traceDeprecation`[#](#processtracedeprecation)

Added in: v0.8.0

* Type: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The `process.traceDeprecation` property indicates whether the
`--trace-deprecation` flag is set on the current Node.js process. See the
documentation for the [`'warning'` event](#event-warning) and the
[`emitWarning()` method](#processemitwarningwarning-type-code-ctor) for more information about this
flag's behavior.

### `process.traceProcessWarnings`[#](#processtraceprocesswarnings)

Added in: v6.10.0

* [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The `process.traceProcessWarnings` property indicates whether the `--trace-warnings` flag
is set on the current Node.js process. This property allows programmatic control over the
tracing of warnings, enabling or disabling stack traces for warnings at runtime.

```
// Enable trace warnings
process.traceProcessWarnings = true;

// Emit a warning with a stack trace
process.emitWarning('Warning with stack trace');

// Disable trace warnings
process.traceProcessWarnings = false;

jscopy
```

### `process.umask()`[#](#processumask)

Added in: v0.1.19History

|  |  |  |  |
| --- | --- | --- | --- |
| Version Changes|  |  | | --- | --- | | v14.0.0, v12.19.0 Calling `process.umask()` with no arguments is deprecated. | | | |

Stability: 0 - Deprecated. Calling `process.umask()` with no argument causes
the process-wide umask to be written twice. This introduces a race condition
between threads, and is a potential security vulnerability. There is no safe,
cross-platform alternative API.

`process.umask()` returns the Node.js process's file mode creation mask. Child
processes inherit the mask from the parent process.

### `process.umask(mask)`[#](#processumaskmask)

Added in: v0.1.19

* `mask` [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) | [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

`process.umask(mask)` sets the Node.js process's file mode creation mask. Child
processes inherit the mask from the parent process. Returns the previous mask.

```
[ ] import { umask } from 'node:process';

const newmask = 0o022;
const oldmask = umask(newmask);
console.log(
  `Changed umask from ${oldmask.toString(8)} to ${newmask.toString(8)}`,
);
const { umask } = require('node:process');

const newmask = 0o022;
const oldmask = umask(newmask);
console.log(
  `Changed umask from ${oldmask.toString(8)} to ${newmask.toString(8)}`,
);

javascriptcopy
```

In [`Worker`](worker_threads.html#class-worker) threads, `process.umask(mask)` will throw an exception.

### `process.unref(maybeRefable)`[#](#processunrefmayberefable)

Added in: v23.6.0, v22.14.0

Stability: 1 - Experimental

* `maybeRefable` [`<any>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#Data_types) An object that may be "unref'd".

An object is "unrefable" if it implements the Node.js "Refable protocol".
Specifically, this means that the object implements the `Symbol.for('nodejs.ref')`
and `Symbol.for('nodejs.unref')` methods. "Ref'd" objects will keep the Node.js
event loop alive, while "unref'd" objects will not. Historically, this was
implemented by using `ref()` and `unref()` methods directly on the objects.
This pattern, however, is being deprecated in favor of the "Refable protocol"
in order to better support Web Platform API types whose APIs cannot be modified
to add `ref()` and `unref()` methods but still need to support that behavior.

### `process.uptime()`[#](#processuptime)

Added in: v0.5.0

* Returns: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

The `process.uptime()` method returns the number of seconds the current Node.js
process has been running.

The return value includes fractions of a second. Use `Math.floor()` to get whole
seconds.

### `process.version`[#](#processversion)

Added in: v0.1.3

* Type: [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The `process.version` property contains the Node.js version string.

```
[ ] import { version } from 'node:process';

console.log(`Version: ${version}`);
// Version: v14.8.0
const { version } = require('node:process');

console.log(`Version: ${version}`);
// Version: v14.8.0

javascriptcopy
```

To get the version string without the prepended *v*, use
`process.versions.node`.

### `process.versions`[#](#processversions)

Added in: v0.2.0History

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Version Changes|  |  |  |  | | --- | --- | --- | --- | | v9.0.0 The `v8` property now includes a Node.js specific suffix.| v4.2.0 The `icu` property is now supported. | | | | | |

* Type: [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)

The `process.versions` property returns an object listing the version strings of
Node.js and its dependencies. `process.versions.modules` indicates the current
ABI version, which is increased whenever a C++ API changes. Node.js will refuse
to load modules that were compiled against a different module ABI version.

```
[ ] import { versions } from 'node:process';

console.log(versions);
const { versions } = require('node:process');

console.log(versions);

javascriptcopy
```

Will generate an object similar to:

```
{ node: '26.0.0-pre',
  acorn: '8.15.0',
  ada: '3.4.1',
  amaro: '1.1.5',
  ares: '1.34.6',
  brotli: '1.2.0',
  merve: '1.0.0',
  cldr: '48.0',
  icu: '78.2',
  llhttp: '9.3.0',
  modules: '144',
  napi: '10',
  nbytes: '0.1.1',
  ncrypto: '0.0.1',
  nghttp2: '1.68.0',
  nghttp3: '',
  ngtcp2: '',
  openssl: '3.5.4',
  simdjson: '4.2.4',
  simdutf: '7.3.3',
  sqlite: '3.51.2',
  tz: '2025c',
  undici: '7.18.2',
  unicode: '17.0',
  uv: '1.51.0',
  uvwasi: '0.0.23',
  v8: '14.3.127.18-node.10',
  zlib: '1.3.1-e00f703',
  zstd: '1.5.7' }

consolecopy
```

### Exit codes[#](#exit-codes)

Node.js will normally exit with a `0` status code when no more async
operations are pending. The following status codes are used in other
cases:

* `1` **Uncaught Fatal Exception**: There was an uncaught exception,
  and it was not handled by a domain or an [`'uncaughtException'`](#event-uncaughtexception) event
  handler.
* `2`: Unused (reserved by Bash for builtin misuse)
* `3` **Internal JavaScript Parse Error**: The JavaScript source code
  internal in the Node.js bootstrapping process caused a parse error. This
  is extremely rare, and generally can only happen during development
  of Node.js itself.
* `4` **Internal JavaScript Evaluation Failure**: The JavaScript
  source code internal in the Node.js bootstrapping process failed to
  return a function value when evaluated. This is extremely rare, and
  generally can only happen during development of Node.js itself.
* `5` **Fatal Error**: There was a fatal unrecoverable error in V8.
  Typically a message will be printed to stderr with the prefix `FATAL ERROR`.
* `6` **Non-function Internal Exception Handler**: There was an
  uncaught exception, but the internal fatal exception handler
  function was somehow set to a non-function, and could not be called.
* `7` **Internal Exception Handler Run-Time Failure**: There was an
  uncaught exception, and the internal fatal exception handler
  function itself threw an error while attempting to handle it. This
  can happen, for example, if an [`'uncaughtException'`](#event-uncaughtexception) or
  `domain.on('error')` handler throws an error.
* `8`: Unused. In previous versions of Node.js, exit code 8 sometimes
  indicated an uncaught exception.
* `9` **Invalid Argument**: Either an unknown option was specified,
  or an option requiring a value was provided without a value.
* `10` **Internal JavaScript Run-Time Failure**: The JavaScript
  source code internal in the Node.js bootstrapping process threw an error
  when the bootstrapping function was called. This is extremely rare,
  and generally can only happen during development of Node.js itself.
* `12` **Invalid Debug Argument**: The `--inspect` and/or `--inspect-brk`
  options were set, but the port number chosen was invalid or unavailable.
* `13` **Unsettled Top-Level Await**: `await` was used outside of a function
  in the top-level code, but the passed `Promise` never settled.
* `14` **Snapshot Failure**: Node.js was started to build a V8 startup
  snapshot and it failed because certain requirements of the state of
  the application were not met.
* `>128` **Signal Exits**: If Node.js receives a fatal signal such as
  `SIGKILL` or `SIGHUP`, then its exit code will be `128` plus the
  value of the signal code. This is a standard POSIX practice, since
  exit codes are defined to be 7-bit integers, and signal exits set
  the high-order bit, and then contain the value of the signal code.
  For example, signal `SIGABRT` has value `6`, so the expected exit
  code will be `128` + `6`, or `134`.
