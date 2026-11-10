// Fork write-ban helper (ADR 0140), Linux. Usage: aiterm-write-ban [--probe] FOLDER -- CMD [ARG...]
// Applies Landlock to this process and everything it starts, then execs CMD (same PID).
// Only write-type rights are handled; they are granted on every sibling along / -> FOLDER, so FOLDER
// (and new entries made directly in its ancestors) is the only unwritable place. Reads, exec, network untouched.
// Fails closed: exit 126 before CMD starts. Built static (no libc on the machine needed) by
// scripts/build-write-ban.mjs; the committed binaries are byte-checked against this source in CI.
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#define SYS_ll_create 444
#define SYS_ll_add 445
#define SYS_ll_restrict 446
#define WRITE_FILE (1ULL << 1)
#define REFER (1ULL << 13)
#define TRUNCATE (1ULL << 14)

struct ruleset_attr { uint64_t fs, net, scoped; };
struct path_beneath { uint64_t allowed; int32_t parent_fd; } __attribute__((packed));

static void die(const char *what) {
  fprintf(stderr, "aiterm write-ban: %s: %s\n", what, strerror(errno));
  exit(126);
}

static int ruleset;
static uint64_t dir_rights, file_rights;

static void grant(int dirfd, const char *name) {
  int fd = openat(dirfd, name, O_PATH | O_CLOEXEC);
  if (fd < 0) return; // unreachable entry: nothing to grant
  struct stat st;
  if (fstat(fd, &st) != 0) die("stat");
  struct path_beneath rule = { S_ISDIR(st.st_mode) ? dir_rights : file_rights, fd };
  if (syscall(SYS_ll_add, ruleset, 1, &rule, 0) != 0) die("add_rule");
  close(fd);
}

int main(int argc, char **argv) {
  int i = 1, probe = 0;
  if (i < argc && strcmp(argv[i], "--probe") == 0) { probe = 1; i++; }
  if (i >= argc) { fprintf(stderr, "aiterm write-ban: usage: [--probe] FOLDER -- CMD...\n"); return 126; }
  char folder[PATH_MAX];
  if (!realpath(argv[i++], folder)) die("folder");
  if (!probe && (i + 1 >= argc || strcmp(argv[i], "--") != 0)) { fprintf(stderr, "aiterm write-ban: missing -- CMD\n"); return 126; }

  long abi = syscall(SYS_ll_create, NULL, 0, 1);
  if (abi < 0) die("landlock unavailable");
  dir_rights = 0;
  for (int b = 1; b <= 14; b++) if (b < 2 || b > 3) dir_rights |= 1ULL << b;
  if (abi < 2) dir_rights &= ~REFER;
  if (abi < 3) dir_rights &= ~TRUNCATE;
  file_rights = dir_rights & (WRITE_FILE | TRUNCATE);
  struct ruleset_attr attr = { dir_rights, 0, 0 };
  ruleset = syscall(SYS_ll_create, &attr, sizeof attr, 0);
  if (ruleset < 0) die("create_ruleset");

  // Walk / -> folder; at each level grant every entry except the next path component.
  char cur[PATH_MAX] = "/";
  char *rest = folder + 1;
  while (*rest) {
    char *slash = strchr(rest, '/');
    size_t len = slash ? (size_t)(slash - rest) : strlen(rest);
    int dfd = open(cur, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd < 0) die(cur);
    DIR *d = fdopendir(dfd);
    if (!d) die(cur);
    struct dirent *e;
    errno = 0;
    while ((e = readdir(d))) {
      if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
      if (strlen(e->d_name) == len && !strncmp(e->d_name, rest, len)) continue;
      grant(dfd, e->d_name);
      errno = 0;
    }
    if (errno) die(cur);
    closedir(d);
    size_t n = strlen(cur);
    if (n > 1) cur[n++] = '/';
    if (n + len >= sizeof cur) { errno = ENAMETOOLONG; die("folder"); }
    memcpy(cur + n, rest, len);
    cur[n + len] = 0;
    rest += len;
    while (*rest == '/') rest++;
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) die("no_new_privs");
  if (syscall(SYS_ll_restrict, ruleset, 0) != 0) die("restrict_self");
  close(ruleset);
  if (probe) { printf("landlock %ld\n", abi); return 0; }
  execvp(argv[i + 1], argv + i + 1);
  die(argv[i + 1]);
}
