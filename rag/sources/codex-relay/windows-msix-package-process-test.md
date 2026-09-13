---
title: "Invoke-CommandInDesktopPackageの公式試験入口"
source_url: "https://learn.microsoft.com/en-us/powershell/module/appx/invoke-commandindesktoppackage?view=windowsserver2025-ps"
source_type: official_docs
fetched: 2026-09-14
topic: codex-relay
tags: ["windows", "msix", "testing"]
summary: "package identityと仮想ファイルシステムを持つprocessを起動する開発用コマンド。子へのcontext継承とPreventBreakawayの指定。"
relevance: "稼働中Desktopを停止せず、MSIX仮想AppDataからAiterm中継を起動する回帰試験に使う。製品の起動経路には使わない。"
chars: 8133
---

[Skip to main content](#main)
[Skip to in-page navigation](#side-doc-outline)
Skip to Ask Learn chat experience

This browser is no longer supported.

Upgrade to Microsoft Edge to take advantage of the latest features, security updates, and technical support.

[Download Microsoft Edge](https://go.microsoft.com/fwlink/p/?LinkID=2092881 )
[More info about Internet Explorer and Microsoft Edge](https://learn.microsoft.com/en-us/lifecycle/faq/internet-explorer-microsoft-edge)

Table of contents

Exit editor mode

Ask Learn

Ask Learn

Reading mode

Table of contents
Read in English

Add

Add to Plans
[Edit](https://github.com/MicrosoftDocs/windows-powershell-docs/blob/main/docset/winserver2025-ps/Appx/Invoke-CommandInDesktopPackage.md)

---

Copy Markdown

Print

---

Note

Access to this page requires authorization. You can try signing in or changing directories.

Access to this page requires authorization. You can try changing directories.

# Invoke-CommandInDesktopPackage

Module:
:   [Appx Module](./?view=windowsserver2025-ps)

##

A debugging tool that creates a new process in the context of a packaged app.

## Syntax

### Default (Default)

```
Invoke-CommandInDesktopPackage
    [-PackageFamilyName] <String>
    [-AppId] <String>
    [-Command] <String>
    [[-Args] <String>]
    [-PreventBreakaway]
    [<CommonParameters>]
```

## Description

`Invoke-CommandInDesktopPackage` creates a new process in the context of the supplied
**PackageFamilyName** and **AppId**.

The created process will have the identity of the provided **AppId** and will have access to its
virtualized file system and registry (if any). The new process will have a token that's similar to,
but not identical to, a real **AppId** process.

The primary use-case of this command is to invoke debugging or troubleshooting tools in the context
of the packaged app to access its virtualized resources. For example, you can run the Registry
Editor to see virtualized registry keys, or Notepad to read virtualized files. See the important
note that follows on using tools such as the Registry Editor that require elevation.

No guarantees are made about the behavior of the created process, other than it having the package
identity and access to the package's virtualized resources. In particular, the new process will
*not* be created in an AppContainer even if an **AppId** process would normally be created in an
AppContainer. Features such as Privacy Controls or other App Settings may or may not apply to the
new process. You shouldn't rely on any specific side-effects of using this command, as they're
undefined and subject to change.

## Examples

### Example 1: Invoke Notepad to read virtualized files

The following command invokes Notepad in the context of the `ContosoApp` app from the
`Contoso.MyApp` package. This allows you to access resources such as a log file or configuration
file stored in the app's virtualized filesystem.

```
$params = @{
    AppId             = 'ContosoApp'
    PackageFamilyName = 'Contoso.MyApp_abcdefgh23456'
    Command           = 'notepad.exe'
}
Invoke-CommandInDesktopPackage @params
```

## Parameters

### -AppId

**AppId** is the Application ID from the target package's manifest.

For example, `MyAppName` is the Application ID in this manifest snippet:

`<Application Id="MyAppName" ... />`

#### Parameter properties

|  |  |
| --- | --- |
| Type: | [String](/en-us/dotnet/api/system.string) |
| Default value: | None |
| Supports wildcards: | False |
| DontShow: | False |

#### Parameter sets

(All)

|  |  |
| --- | --- |
| Position: | 2 |
| Mandatory: | True |
| Value from pipeline: | True |
| Value from pipeline by property name: | True |
| Value from remaining arguments: | False |

### -Args

Optional arguments to be passed to the new process. For example, `/foo /bar`.

#### Parameter properties

|  |  |
| --- | --- |
| Type: | [String](/en-us/dotnet/api/system.string) |
| Default value: | None |
| Supports wildcards: | False |
| DontShow: | False |

#### Parameter sets

(All)

|  |  |
| --- | --- |
| Position: | 4 |
| Mandatory: | False |
| Value from pipeline: | True |
| Value from pipeline by property name: | True |
| Value from remaining arguments: | False |

### -Command

An executable to invoke, like `regedit.exe`.

Note that if the executable requires elevation (like `regedit`), you must call
`Invoke-CommandInDesktopPackage` from an already-elevated context. Calling
`Invoke-CommandInDesktopPackage` from a non-elevated context doesn't work as expected. The new
process is created without the package context, and the PowerShell command fails.

#### Parameter properties

|  |  |
| --- | --- |
| Type: | [String](/en-us/dotnet/api/system.string) |
| Default value: | None |
| Supports wildcards: | False |
| DontShow: | False |

#### Parameter sets

(All)

|  |  |
| --- | --- |
| Position: | 3 |
| Mandatory: | True |
| Value from pipeline: | True |
| Value from pipeline by property name: | True |
| Value from remaining arguments: | False |

### -PackageFamilyName

The Package Family Name of the target package. You can retrieve this by calling
[Get-AppxPackage](get-appxpackage?view=windowsserver2025-ps).

#### Parameter properties

|  |  |
| --- | --- |
| Type: | [String](/en-us/dotnet/api/system.string) |
| Default value: | None |
| Supports wildcards: | False |
| DontShow: | False |

#### Parameter sets

(All)

|  |  |
| --- | --- |
| Position: | 1 |
| Mandatory: | True |
| Value from pipeline: | True |
| Value from pipeline by property name: | True |
| Value from remaining arguments: | False |

### -PreventBreakaway

Causes all child processes of the invoked process to also be created in the context of the
**AppId**. By default, child processes are created without any context. This switch is useful for
running `cmd.exe` so that you can launch multiple other tools in the package context.

#### Parameter properties

|  |  |
| --- | --- |
| Type: | [SwitchParameter](/en-us/dotnet/api/system.management.automation.switchparameter) |
| Default value: | None |
| Supports wildcards: | False |
| DontShow: | False |

#### Parameter sets

(All)

|  |  |
| --- | --- |
| Position: | 5 |
| Mandatory: | False |
| Value from pipeline: | True |
| Value from pipeline by property name: | True |
| Value from remaining arguments: | False |

### CommonParameters

This cmdlet supports the common parameters: -Debug, -ErrorAction, -ErrorVariable,
-InformationAction, -InformationVariable, -OutBuffer, -OutVariable, -PipelineVariable,
-ProgressAction, -Verbose, -WarningAction, and -WarningVariable. For more information, see
[about\_CommonParameters](https://go.microsoft.com/fwlink/?LinkID=113216).

## Inputs

### [String](/en-us/dotnet/api/system.string)

## Outputs

### [Object](/en-us/dotnet/api/system.object)

## Related Links

* [Get-AppxPackage](get-appxpackage?view=windowsserver2025-ps)

---

## Feedback

Was this page helpful?

Yes

No

No

Need help with this topic?

Want to try using Ask Learn to clarify or guide you through this topic?

Ask Learn

Ask Learn

 Suggest a fix?

### In this article

Was this page helpful?

Need help with this topic?

Want to try using Ask Learn to clarify or guide you through this topic?

Ask Learn

Ask Learn

 Suggest a fix?

en-us

[Your Privacy Choices](https://aka.ms/yourcaliforniaprivacychoices)

Theme

* Light
* Dark
* High contrast

* [AI Disclaimer](https://learn.microsoft.com/en-us/principles-for-ai-generated-content)
* [Previous Versions](https://learn.microsoft.com/en-us/previous-versions/)
* [Blog](https://techcommunity.microsoft.com/t5/microsoft-learn-blog/bg-p/MicrosoftLearnBlog)
* [Contribute](https://learn.microsoft.com/en-us/contribute)
* [Privacy](https://go.microsoft.com/fwlink/?LinkId=521839)
* [Consumer Health Privacy](https://go.microsoft.com/fwlink/?linkid=2259814)
* [Terms of Use](https://learn.microsoft.com/en-us/legal/termsofuse)
* [Trademarks](https://www.microsoft.com/legal/intellectualproperty/Trademarks/)
* © Microsoft 2026

![](https://learn.microsoft.com/akam/13/pixel_5dec235f?a=dD04MjRiODg0MmY3OWY4NjhlMWY0MDgwMzJkMzFhNDU0OWIxZmU1ZTExJmpzPW9mZg==)
