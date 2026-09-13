---
title: "Apple: macOS Keychain項目ごとのアプリ許可"
source_url: "https://developer.apple.com/documentation/security/access-control-lists.md"
source_type: official_docs
fetched: 2026-09-13
topic: completion-detection
tags: ["macos", "keychain", "acl"]
summary: "Apple一次資料。Keychain項目の操作と信頼アプリの一覧でアクセスを判定し、未許可アプリには利用者の確認を求める。"
relevance: "OpenAI向けの既存許可を独自署名の改造版へ無条件に継承できないことの根拠。"
chars: 9975
---

<!--
{
  "documentType" : "article",
  "framework" : "Security",
  "identifier" : "/documentation/Security/access-control-lists",
  "metadataVersion" : "0.1.0",
  "role" : "collectionGroup",
  "title" : "Access Control Lists"
}
-->

# Access Control Lists

Control which apps have access to keychain items in macOS.

## Discussion

In macOS, for items not stored on the iCloud keychain, each protected keychain item—like a password or private key—has an associated access instance that contains an access control list (ACL). The entries in this list in turn each contain an array of operations and an array of apps trusted to carry out those operations with the item. The collection of ACL entries govern the accessibility of the corresponding keychain item.

![Diagram showing the detailed contents of access attribute of a kechain item, namely an access control list composed of entries for different operations and trusted apps.](images/com.apple.security/media-2983146@2x.png)

When an app attempts to access a keychain item for a particular purpose—like using a private key to sign a document—the system looks for an entry in the item’s ACL containing the operation. If there’s no entry that lists the operation, then the system denies access and it’s up to the calling app to try something else or to notify the user.

If there is an entry that lists the operation, the system checks whether the calling app is among the entry’s trusted apps. If so, the system grants access. Otherwise, the system prompts the user for confirmation. The user may choose to Deny, Allow, or Always Allow the access. In the latter case, the system adds the app to the list of trusted apps for that entry, enabling the app to gain access in the future without prompting the user again.

> Important:
> ACLs are not available in iOS or in macOS apps that use the iCloud keychain. For keychain item sharing in those environments, use access groups instead. See <doc://com.apple.security/documentation/Security/sharing-access-to-keychain-items-among-a-collection-of-apps>.

## Topics

### Access Creation

[`func SecAccessCreate(CFString, CFArray?, UnsafeMutablePointer<SecAccess?>) -> OSStatus`](/documentation/Security/SecAccessCreate(_:_:_:))

Creates a new access instance associated with a given protected keychain item.

[`func SecAccessCreateWithOwnerAndACL(uid_t, gid_t, SecAccessOwnerType, CFArray?, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> SecAccess?`](/documentation/Security/SecAccessCreateWithOwnerAndACL(_:_:_:_:_:))

Creates a new access instance using the owner and ACL entries you provide.

[`typealias SecAccessOwnerType`](/documentation/Security/SecAccessOwnerType)

A type for flags that enable you to configure ACL ownership.

[SecAccessOwnerType Values](/documentation/Security/SecAccessOwnerType-values)

Flags that enable you to configure ACL ownership.

[`class SecAccess`](/documentation/Security/SecAccess)

An opaque type that identifies a keychain item’s access information.

[`func SecAccessGetTypeID() -> CFTypeID`](/documentation/Security/SecAccessGetTypeID())

Returns the unique identifier of the opaque type to which an access instance belongs.

### Access Query

[`func SecAccessCopyACLList(SecAccess, UnsafeMutablePointer<CFArray?>) -> OSStatus`](/documentation/Security/SecAccessCopyACLList(_:_:))

Retrieves all the ACL entries of a given access instance.

[`func SecAccessCopyMatchingACLList(SecAccess, CFTypeRef) -> CFArray?`](/documentation/Security/SecAccessCopyMatchingACLList(_:_:))

Retrieves selected ACL entries from a given access instance.

[`func SecAccessCopyOwnerAndACL(SecAccess, UnsafeMutablePointer<uid_t>?, UnsafeMutablePointer<gid_t>?, UnsafeMutablePointer<SecAccessOwnerType>?, UnsafeMutablePointer<CFArray?>?) -> OSStatus`](/documentation/Security/SecAccessCopyOwnerAndACL(_:_:_:_:_:))

Retrieves the owner and the ACL entries of a given access instance.

### Access Control List Entries

[`func SecACLCreateWithSimpleContents(SecAccess, CFArray?, CFString, SecKeychainPromptSelector, UnsafeMutablePointer<SecACL?>) -> OSStatus`](/documentation/Security/SecACLCreateWithSimpleContents(_:_:_:_:_:))

Creates a new ACL entry with the given characteristics, and adds it to an access instance.

[`func SecACLRemove(SecACL) -> OSStatus`](/documentation/Security/SecACLRemove(_:))

Removes the specified ACL entry from the access instance that contains it.

[ACL Authorization Keys](/documentation/Security/acl-authorization-keys)

The operations an access control list entry applies to.

[`struct SecKeychainPromptSelector`](/documentation/Security/SecKeychainPromptSelector)

Bits that define when a keychain should require a passphrase.

[`class SecACL`](/documentation/Security/SecACL)

An opaque type that represents information about an ACL entry.

[`func SecACLGetTypeID() -> CFTypeID`](/documentation/Security/SecACLGetTypeID())

Returns the unique identifier of the opaque type to which an ACL entry belongs.

### Access Control List Configuration

[`func SecACLCopyContents(SecACL, UnsafeMutablePointer<CFArray?>, UnsafeMutablePointer<CFString?>, UnsafeMutablePointer<SecKeychainPromptSelector>) -> OSStatus`](/documentation/Security/SecACLCopyContents(_:_:_:_:))

Returns the application list, description, and prompt selector for a given ACL entry.

[`func SecACLSetContents(SecACL, CFArray?, CFString, SecKeychainPromptSelector) -> OSStatus`](/documentation/Security/SecACLSetContents(_:_:_:_:))

Sets the application list, description, and prompt selector for a given ACL entry.

[`func SecACLCopyAuthorizations(SecACL) -> CFArray`](/documentation/Security/SecACLCopyAuthorizations(_:))

Retrieves the authorization tags of a given ACL entry.

[`func SecACLUpdateAuthorizations(SecACL, CFArray) -> OSStatus`](/documentation/Security/SecACLUpdateAuthorizations(_:_:))

Sets the authorization tags for a given ACL.

### Trusted Applications

[`func SecTrustedApplicationCreateFromPath(UnsafePointer<CChar>?, UnsafeMutablePointer<SecTrustedApplication?>) -> OSStatus`](/documentation/Security/SecTrustedApplicationCreateFromPath(_:_:))

Creates a trusted app instance based on the app at the given path in the file system.

[`func SecTrustedApplicationCopyData(SecTrustedApplication, UnsafeMutablePointer<CFData?>) -> OSStatus`](/documentation/Security/SecTrustedApplicationCopyData(_:_:))

Retrieves the data of a trusted app instance.

[`func SecTrustedApplicationSetData(SecTrustedApplication, CFData) -> OSStatus`](/documentation/Security/SecTrustedApplicationSetData(_:_:))

Sets the data of a given trusted app instance.

[`class SecTrustedApplication`](/documentation/Security/SecTrustedApplication)

An opaque type that contains information about a trusted app.

[`func SecTrustedApplicationGetTypeID() -> CFTypeID`](/documentation/Security/SecTrustedApplicationGetTypeID())

Returns the unique identifier of the opaque type to which a trusted app instance belongs.

### Keychain Item Access

[`func SecKeychainItemSetAccess(SecKeychainItem, SecAccess) -> OSStatus`](/documentation/Security/SecKeychainItemSetAccess(_:_:))

Sets the access of a given keychain item.

[`func SecKeychainItemCopyAccess(SecKeychainItem, UnsafeMutablePointer<SecAccess?>) -> OSStatus`](/documentation/Security/SecKeychainItemCopyAccess(_:_:))

Retrieves the access of a given keychain item.

### Legacy Access Control Operations

[`OSStatus SecACLCreateFromSimpleContents(SecAccessRef access, CFArrayRef applicationList, CFStringRef description, const CSSM_ACL_KEYCHAIN_PROMPT_SELECTOR *promptSelector, SecACLRef*newAcl);`](/documentation/Security/SecACLCreateFromSimpleContents)

Creates a new access control list entry from the application list, description, and prompt selector provided and adds it to an item’s access object.

[`OSStatus SecACLCopySimpleContents(SecACLRef acl, CFArrayRef*applicationList, CFStringRef*description, CSSM_ACL_KEYCHAIN_PROMPT_SELECTOR *promptSelector);`](/documentation/Security/SecACLCopySimpleContents)

Returns the application list, description, and CSSM prompt selector for a given access control list entry.

[`OSStatus SecACLSetSimpleContents(SecACLRef acl, CFArrayRef applicationList, CFStringRef description, const CSSM_ACL_KEYCHAIN_PROMPT_SELECTOR *promptSelector);`](/documentation/Security/SecACLSetSimpleContents)

Sets the application list, description, and prompt selector for a given access control list entry.

[`OSStatus SecACLGetAuthorizations(SecACLRef acl, CSSM_ACL_AUTHORIZATION_TAG *tags, uint32 *tagCount);`](/documentation/Security/SecACLGetAuthorizations)

Retrieves the CSSM authorization tags of a given access control list entry.

[`OSStatus SecACLSetAuthorizations(SecACLRef acl, CSSM_ACL_AUTHORIZATION_TAG *tags, uint32 tagCount);`](/documentation/Security/SecACLSetAuthorizations)

Sets the CSSM authorization tags for a given access control list entry.

[`OSStatus SecAccessCopySelectedACLList(SecAccessRef accessRef, CSSM_ACL_AUTHORIZATION_TAG action, CFArrayRef*aclList);`](/documentation/Security/SecAccessCopySelectedACLList)

Retrieves selected access control lists from a given access object.

[`OSStatus SecAccessCreateFromOwnerAndACL(const CSSM_ACL_OWNER_PROTOTYPE *owner, uint32 aclCount, const CSSM_ACL_ENTRY_INFO *acls, SecAccessRef*accessRef);`](/documentation/Security/SecAccessCreateFromOwnerAndACL)

Creates a new access object using the owner and access control list you provide.

[`OSStatus SecAccessGetOwnerAndACL(SecAccessRef accessRef, CSSM_ACL_OWNER_PROTOTYPE_PTR*owner, uint32 *aclCount, CSSM_ACL_ENTRY_INFO_PTR*acls);`](/documentation/Security/SecAccessGetOwnerAndACL)

Retrieves the owner and the access control list of a given access object.

[`typedef struct __SecAccess OpaqueSecAccessRef;`](/documentation/Security/OpaqueSecAccessRef)



---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)
