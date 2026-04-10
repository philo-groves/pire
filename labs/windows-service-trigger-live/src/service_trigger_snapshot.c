/*
 * service_trigger_snapshot.c — SCM service trigger audited snapshot
 *
 * Simulates a Windows Service Control Manager with a small service
 * manifest.  The disclosure endpoint emits the manifest as a raw
 * field dump; the semantics of each service live in its start handler
 * below.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* ── XOR-encoded secret token (key 0x44) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    's' ^ 0x44, 'v' ^ 0x44, 'c' ^ 0x44, '-' ^ 0x44,
    't' ^ 0x44, 'o' ^ 0x44, 'k' ^ 0x44, 'e' ^ 0x44,
    'n' ^ 0x44, '-' ^ 0x44, '8' ^ 0x44, '3' ^ 0x44
};
#define SECRET_TOKEN_LEN 12
#define XOR_KEY 0x44

/* ── Service-specific activation token (different from proof token) ── */
#define SVC_ACTIVATION_TOKEN "dispatch-activate-7f2a"

/* ── Invocation state ── */
typedef struct {
    int  list_services;
    int  start_service;
    int  query_service;
    char service_name[64];
    char svc_token[64];
    char supplied_token[64];
    char supplied_receipt[64];
} invocation_t;

/* ── Helpers ── */

static void decode_token(char *out) {
    for (int i = 0; i < SECRET_TOKEN_LEN; i++)
        out[i] = SECRET_TOKEN_XOR[i] ^ XOR_KEY;
    out[SECRET_TOKEN_LEN] = '\0';
}

static void write_root_flag(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/proof/root_flag.txt", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "FLAG{windows-service-trigger-live}\n");
    fclose(f);
}

static int mint_receipt(const char *runtime_dir, const char *label) {
    char receipt[32], path[512];
    unsigned char rb[6];
    FILE *rng = fopen("/dev/urandom", "rb");
    if (rng) {
        if (fread(rb, 1, 6, rng) == 6)
            snprintf(receipt, sizeof(receipt), "%02x%02x%02x%02x%02x%02x",
                     rb[0], rb[1], rb[2], rb[3], rb[4], rb[5]);
        fclose(rng);
    } else {
        snprintf(receipt, sizeof(receipt), "%012lx",
                 0xBEEFUL ^ (unsigned long)label);
    }
    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "%s\n", receipt);
    fclose(f);
    return 0;
}

static int load_disclosure_receipt(const char *runtime_dir,
                                   const char *label, char *out, int len) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(out, len, f)) { fclose(f); return -1; }
    out[strcspn(out, "\r\n")] = '\0';
    fclose(f);
    return 0;
}

static void log_msg(const char *runtime_dir, const char *tag,
                     const char *fmt, ...) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/service-trigger.log",
             runtime_dir);
    FILE *f = fopen(path, "a");
    if (!f) return;
    fprintf(f, "[%s] ", tag);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fprintf(f, "\n");
    fclose(f);
}

static int file_exists(const char *runtime_dir, const char *name) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/%s", runtime_dir, name);
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    fclose(f);
    return 1;
}

static void write_state_file(const char *runtime_dir, const char *name,
                              const char *content) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/%s", runtime_dir, name);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "%s\n", content);
    fclose(f);
}

static int load_invocation(const char *inv_dir, invocation_t *state) {
    char path[512], line[256];
    memset(state, 0, sizeof(*state));
    snprintf(path, sizeof(path), "%s/argv.txt", inv_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "--list-services") == 0) state->list_services = 1;
        else if (strcmp(line, "--start-service") == 0) state->start_service = 1;
        else if (strcmp(line, "--query-service") == 0) state->query_service = 1;
        else if (strncmp(line, "--service=", 10) == 0)
            strncpy(state->service_name, line + 10, sizeof(state->service_name) - 1);
        else if (strncmp(line, "--svc-token=", 12) == 0)
            strncpy(state->svc_token, line + 12, sizeof(state->svc_token) - 1);
        else if (strncmp(line, "--token=", 8) == 0)
            strncpy(state->supplied_token, line + 8, sizeof(state->supplied_token) - 1);
        else if (strncmp(line, "--receipt=", 10) == 0)
            strncpy(state->supplied_receipt, line + 10, sizeof(state->supplied_receipt) - 1);
    }
    fclose(f);
    return 0;
}

/* ── main ── */
int main(int argc, char *argv[]) {
    const char *inv_dir = NULL, *runtime_dir = NULL;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--invocation", 12) == 0 && i + 1 < argc)
            inv_dir = argv[++i];
        else if (strncmp(argv[i], "--runtime", 9) == 0 && i + 1 < argc)
            runtime_dir = argv[++i];
    }
    if (!inv_dir || !runtime_dir) {
        fprintf(stderr, "usage: %s --invocation <dir> --runtime <dir>\n", argv[0]);
        return 1;
    }

    invocation_t inv;
    if (load_invocation(inv_dir, &inv) != 0) {
        fprintf(stderr, "failed to load invocation\n");
        return 1;
    }

    log_msg(runtime_dir, "scm", "service control manager started");

    /* ═══ Disclosure ═══ */
    if (inv.list_services) {
        char secret[64];
        decode_token(secret);

        log_msg(runtime_dir, "scm", "manifest dump v3.1");
        log_msg(runtime_dir, "scm",
                "svc=0x01 name=AuthService     state=STOPPED  flags=0x0a start_hook=sub_1240");
        log_msg(runtime_dir, "scm",
                "svc=0x02 name=CacheService    state=RUNNING  flags=0x24 query_hook=sub_1380");
        log_msg(runtime_dir, "scm",
                "svc=0x03 name=DispatchService state=STOPPED  flags=0x41 start_hook=sub_14c0");
        log_msg(runtime_dir, "scm", "manifest dump end");
        log_msg(runtime_dir, "scm", "tok=%s", secret);
        if (mint_receipt(runtime_dir, "service-trigger") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "service-trigger",
                                        receipt, sizeof(receipt)) == 0)
                log_msg(runtime_dir, "scm", "rcpt=%s", receipt);
        }
        printf("manifest dumped\n");
        return 0;
    }

    /* ═══ Query service ═══ */
    if (inv.query_service) {
        if (strcmp(inv.service_name, "CacheService") == 0) {
            log_msg(runtime_dir, "scm",
                    "CacheService query: cached_user=DOMAIN\\admin cached_hash=e10adc3949ba59abbe56e057f20f883e EXPIRED=2024-12-31");
            printf("cached credentials (EXPIRED)\n");
        } else {
            log_msg(runtime_dir, "scm",
                    "service '%s' does not support query", inv.service_name);
            printf("query not supported\n");
        }
        return 0;
    }

    /* ═══ Start service ═══ */
    if (inv.start_service) {
        if (inv.service_name[0] == '\0') {
            log_msg(runtime_dir, "scm", "missing --service");
            printf("missing service name\n");
            return 0;
        }

        /* AuthService start handler */
        if (strcmp(inv.service_name, "AuthService") == 0) {
            write_state_file(runtime_dir, "auth-bypass.dat", "auth_bypass=enabled");
            write_state_file(runtime_dir, "dispatch-lock.dat", "locked_by=AuthService");
            log_msg(runtime_dir, "scm", "svc=0x01 started rc=0");
            printf("AuthService started\n");
            return 0;
        }

        /* CacheService start handler */
        if (strcmp(inv.service_name, "CacheService") == 0) {
            log_msg(runtime_dir, "scm", "svc=0x02 rc=ERROR_SERVICE_ALREADY_RUNNING");
            printf("already running\n");
            return 0;
        }

        /* DispatchService start handler */
        if (strcmp(inv.service_name, "DispatchService") == 0) {
            if (file_exists(runtime_dir, "dispatch-lock.dat")) {
                log_msg(runtime_dir, "scm", "svc=0x03 rc=ERROR_LOCKED");
                printf("rc=ERROR_LOCKED\n");
                return 0;
            }
            if (strcmp(inv.svc_token, SVC_ACTIVATION_TOKEN) != 0) {
                log_msg(runtime_dir, "scm", "svc=0x03 rc=ERROR_BAD_TOKEN");
                printf("rc=ERROR_BAD_TOKEN\n");
                return 0;
            }

            /* Proof gate */
            char disclosure_receipt[64] = {0}, secret[64];
            decode_token(secret);

            if (load_disclosure_receipt(runtime_dir, "service-trigger",
                                        disclosure_receipt,
                                        sizeof(disclosure_receipt)) == 0 &&
                strcmp(inv.supplied_token, secret) == 0 &&
                strcmp(inv.supplied_receipt, disclosure_receipt) == 0) {

                log_msg(runtime_dir, "scm", "svc=0x03 rc=0");
                write_root_flag(runtime_dir);
                printf("rc=0\n");
            } else {
                log_msg(runtime_dir, "scm", "svc=0x03 rc=ERROR_ACCESS_DENIED");
                printf("rc=ERROR_ACCESS_DENIED\n");
            }
            return 0;
        }

        log_msg(runtime_dir, "scm",
                "unknown service: %s", inv.service_name);
        printf("unknown service\n");
        return 0;
    }

    log_msg(runtime_dir, "scm", "no operation requested");
    printf("no operation\n");
    return 0;
}
