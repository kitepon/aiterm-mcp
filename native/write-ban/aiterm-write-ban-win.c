// Fork write-ban helper (ADR 0140), Windows. Usage: aiterm-write-ban.exe [--probe] FOLDER -- CMD [ARG...]
// The CLI runs under a restricted copy of this process's token: no privileges (no backup/restore/take-ownership
// bypass), and a second access check against the token's own user/group SIDs plus one Aiterm marker SID.
// FOLDER carries an inheritable Deny ACE for write-type rights to that marker SID, so only processes started by this
// helper are refused inside it; every other process (the main seat included) is unaffected, and writes elsewhere
// pass the second check through the user and group SIDs. An OWNER RIGHTS ACE equal to the owner's implicit rights
// (READ_CONTROL | WRITE_DAC) removes the implicit WRITE_DAC the marker-bearing owner would otherwise keep.
// The ACEs are inert for any token without the marker, so they stay after the fork ends (no cleanup state).
// The CLI and its children run in a kill-on-close job; the helper waits and exits with the CLI's code.
// Fails closed: exit 126 before CMD starts. Built by scripts/build-write-ban.mjs.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

// NT SERVICE\AitermWriteBan (sc showsid AitermWriteBan): a service SID no account or service holds.
static const wchar_t *MARKER = L"S-1-5-80-514291735-1343965553-2406807490-797346590-2268465857";
#define BAN_MASK (FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE | WRITE_DAC | WRITE_OWNER)
#define INHERIT (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)

static void die(const char *what, DWORD err) {
  fprintf(stderr, "aiterm write-ban: %s: error %lu\n", what, (unsigned long)err);
  exit(126);
}

static int has_ace(PACL dacl, PSID sid, BYTE type, ACCESS_MASK mask) {
  ACL_SIZE_INFORMATION info;
  if (!dacl || !GetAclInformation(dacl, &info, sizeof info, AclSizeInformation)) return 0;
  for (DWORD i = 0; i < info.AceCount; i++) {
    ACE_HEADER *h;
    if (!GetAce(dacl, i, (void **)&h) || h->AceType != type || (h->AceFlags & INHERIT) != INHERIT || (h->AceFlags & INHERITED_ACE)) continue;
    ACCESS_ALLOWED_ACE *a = (ACCESS_ALLOWED_ACE *)h; // same layout for ACCESS_DENIED_ACE
    if (a->Mask == mask && EqualSid((PSID)&a->SidStart, sid)) return 1;
  }
  return 0;
}

// Adds the two explicit ACEs once; Windows propagates them to existing children and new entries inherit them.
static void ensure_folder_acl(const wchar_t *folder, PSID marker) {
  PACL dacl = NULL; PSECURITY_DESCRIPTOR sd = NULL;
  DWORD r = GetNamedSecurityInfoW(folder, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, &dacl, NULL, &sd);
  if (r != ERROR_SUCCESS) die("read folder ACL", r);
  PSID owner_rights = NULL;
  if (!ConvertStringSidToSidW(L"S-1-3-4", &owner_rights)) die("owner rights SID", GetLastError());
  int deny = has_ace(dacl, marker, ACCESS_DENIED_ACE_TYPE, BAN_MASK);
  int own = has_ace(dacl, owner_rights, ACCESS_ALLOWED_ACE_TYPE, READ_CONTROL | WRITE_DAC);
  if (!deny || !own) {
    EXPLICIT_ACCESS_W e[2]; ZeroMemory(e, sizeof e);
    e[0].grfAccessPermissions = BAN_MASK; e[0].grfAccessMode = DENY_ACCESS; e[0].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
    e[0].Trustee.TrusteeForm = TRUSTEE_IS_SID; e[0].Trustee.ptstrName = (LPWSTR)marker;
    e[1].grfAccessPermissions = READ_CONTROL | WRITE_DAC; e[1].grfAccessMode = GRANT_ACCESS; e[1].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
    e[1].Trustee.TrusteeForm = TRUSTEE_IS_SID; e[1].Trustee.ptstrName = (LPWSTR)owner_rights;
    PACL next = NULL;
    r = SetEntriesInAclW(2, e, dacl, &next);
    if (r != ERROR_SUCCESS) die("build folder ACL", r);
    r = SetNamedSecurityInfoW((LPWSTR)folder, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, next, NULL);
    if (r != ERROR_SUCCESS) die("write folder ACL", r);
    LocalFree(next);
  }
  LocalFree(owner_rights); LocalFree(sd);
}

static HANDLE restricted_token(PSID marker) {
  HANDLE self, out;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID, &self))
    die("open token", GetLastError());
  DWORD n = 0;
  GetTokenInformation(self, TokenGroups, NULL, 0, &n);
  TOKEN_GROUPS *groups = malloc(n);
  if (!groups || !GetTokenInformation(self, TokenGroups, groups, n, &n)) die("token groups", GetLastError());
  BYTE userbuf[SECURITY_MAX_SID_SIZE + sizeof(TOKEN_USER)];
  if (!GetTokenInformation(self, TokenUser, userbuf, sizeof userbuf, &n)) die("token user", GetLastError());
  PSID restricted_sid = NULL;
  if (!ConvertStringSidToSidW(L"S-1-5-12", &restricted_sid)) die("restricted SID", GetLastError());
  SID_AND_ATTRIBUTES *sids = calloc(groups->GroupCount + 3, sizeof *sids);
  DWORD c = 0;
  sids[c++].Sid = ((TOKEN_USER *)userbuf)->User.Sid;
  for (DWORD i = 0; i < groups->GroupCount; i++) {
    DWORD a = groups->Groups[i].Attributes;
    if ((a & SE_GROUP_ENABLED) && !(a & SE_GROUP_USE_FOR_DENY_ONLY) && !(a & SE_GROUP_INTEGRITY)) sids[c++].Sid = groups->Groups[i].Sid;
  }
  sids[c++].Sid = restricted_sid;
  sids[c++].Sid = marker;
  if (!CreateRestrictedToken(self, DISABLE_MAX_PRIVILEGE, 0, NULL, 0, NULL, c, sids, &out)) die("restricted token", GetLastError());
  CloseHandle(self);
  return out;
}

// MSVC argv quoting (CommandLineToArgvW rules), so the CLI sees exactly the arguments the launch line gave.
static void append_arg(wchar_t **buf, size_t *len, size_t *cap, const wchar_t *arg) {
  size_t need = *len + wcslen(arg) * 2 + 4;
  if (need > *cap) { *cap = need * 2; *buf = realloc(*buf, *cap * sizeof(wchar_t)); }
  wchar_t *p = *buf + *len;
  if (*len) *p++ = L' ';
  int quote = !*arg || wcspbrk(arg, L" \t\"") != NULL;
  if (quote) *p++ = L'"';
  for (const wchar_t *s = arg;; s++) {
    size_t bs = 0;
    while (*s == L'\\') { s++; bs++; }
    if (!*s) { for (size_t k = 0; k < (quote ? bs * 2 : bs); k++) *p++ = L'\\'; break; }
    if (*s == L'"') { for (size_t k = 0; k < bs * 2 + 1; k++) *p++ = L'\\'; *p++ = L'"'; }
    else { for (size_t k = 0; k < bs; k++) *p++ = L'\\'; *p++ = *s; }
  }
  if (quote) *p++ = L'"';
  *p = 0;
  *len = p - *buf;
}

int main(void) {
  int argc; wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  int i = 1, probe = 0;
  if (i < argc && !wcscmp(argv[i], L"--probe")) { probe = 1; i++; }
  if (i >= argc) { fprintf(stderr, "aiterm write-ban: usage: [--probe] FOLDER -- CMD...\n"); return 126; }
  wchar_t folder[MAX_PATH * 4];
  if (!GetFullPathNameW(argv[i++], MAX_PATH * 4, folder, NULL)) die("folder", GetLastError());
  DWORD attrs = GetFileAttributesW(folder);
  if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY)) die("folder", ERROR_PATH_NOT_FOUND);
  if (!probe && (i + 1 >= argc || wcscmp(argv[i], L"--"))) { fprintf(stderr, "aiterm write-ban: missing -- CMD\n"); return 126; }
  PSID marker = NULL;
  if (!ConvertStringSidToSidW(MARKER, &marker)) die("marker SID", GetLastError());
  ensure_folder_acl(folder, marker);
  HANDLE token = restricted_token(marker);

  if (probe) {
    // Prove the ban: under the restricted token a new file inside the folder must be refused.
    wchar_t file[MAX_PATH * 4 + 64];
    swprintf(file, sizeof file / sizeof *file, L"%ls\\.aiterm-write-ban-probe-%lu", folder, (unsigned long)GetCurrentProcessId());
    if (!ImpersonateLoggedOnUser(token)) die("impersonate", GetLastError());
    HANDLE h = CreateFileW(file, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    DWORD err = GetLastError();
    RevertToSelf();
    if (h != INVALID_HANDLE_VALUE) { CloseHandle(h); DeleteFileW(file); fprintf(stderr, "aiterm write-ban: probe write was not refused\n"); return 126; }
    if (err != ERROR_ACCESS_DENIED) die("probe write", err);
    printf("restricted-token\n");
    return 0;
  }

  wchar_t *line = NULL; size_t len = 0, cap = 0;
  for (int k = i + 1; k < argc; k++) append_arg(&line, &len, &cap, argv[k]);
  HANDLE job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim; ZeroMemory(&lim, sizeof lim);
  lim.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &lim, sizeof lim)) die("job", GetLastError());
  STARTUPINFOW si; ZeroMemory(&si, sizeof si); si.cb = sizeof si;
  PROCESS_INFORMATION pi;
  if (!CreateProcessAsUserW(token, NULL, line, NULL, NULL, TRUE, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, NULL, NULL, &si, &pi))
    die("start", GetLastError());
  if (!AssignProcessToJobObject(job, pi.hProcess)) { TerminateProcess(pi.hProcess, 126); die("job assign", GetLastError()); }
  ResumeThread(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 126;
  GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}
