---
title: "Apple: Keychain Servicesの対話制御と適用上の注意"
source_url: "https://developer.apple.com/documentation/security/seckeychainsetuserinteractionallowed(_:).md"
source_type: official_docs
fetched: 2026-09-13
topic: completion-detection
tags: ["macos", "keychain", "noninteractive"]
summary: "Apple一次資料。対話を無効化したKeychain操作はエラーを返す。旧APIであり、再有効化しない場合の他クライアントへの影響も説明する。"
relevance: "無人のMCP状態取得でダイアログを連発しない設計の候補。全体のon/offを各読取りの一時ガードにする案の注意点。"
chars: 2605
---

<!--
{
  "availability" : [
    "macOS: 10.2.0 - 10.10.0"
  ],
  "documentType" : "symbol",
  "framework" : "Security",
  "identifier" : "/documentation/Security/SecKeychainSetUserInteractionAllowed(_:)",
  "metadataVersion" : "0.1.0",
  "role" : "Function",
  "symbol" : {
    "kind" : "Function",
    "modules" : [
      "Security"
    ],
    "preciseIdentifier" : "c:@F@SecKeychainSetUserInteractionAllowed"
  },
  "title" : "SecKeychainSetUserInteractionAllowed(_:)"
}
-->

# SecKeychainSetUserInteractionAllowed(_:)

Enables or disables the user interface for keychain services functions that automatically display a user interface.

```
func SecKeychainSetUserInteractionAllowed(_ state: Bool) -> OSStatus
```

## Parameters

`state`

A flag that indicates whether the keychain services will display a user interface. If you pass <doc://com.apple.documentation/documentation/Swift/true>, user interaction is allowed. This is the default value. If <doc://com.apple.documentation/documentation/Swift/false>, keychain services functions that normally display a user interface will instead return an error.

## Return Value

A result code. See [Security Framework Result Codes](/documentation/Security/security-framework-result-codes).

## Discussion

Certain keychain services functions that require the presence of a keychain automatically display a *Keychain Not Found* dialog if there is none. Functions that require the keychain to be unlocked automatically display the *Unlock Keychain* dialog. The [`SecKeychainSetUserInteractionAllowed(_:)`](/documentation/Security/SecKeychainSetUserInteractionAllowed(_:)) function enables you to control whether these functions display a user interface. By default, user interaction is permitted.

If you are writing an application that must run unattended on a server, you may wish to disable the user interface so that any subsequent keychain calls that normally bring up the unlock UI will instead return immediately with an [`errSecInteractionRequired`](/documentation/Security/errSecInteractionRequired) result). In this case you must programmatically create a keychain or unlock the keychain when necessary.

### Special Considerations

If you disable user interaction before calling a Keychain Services function, be sure to reenable it when you are finished. Failure to reenable user interaction will affect other clients of the Keychain Services.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)
