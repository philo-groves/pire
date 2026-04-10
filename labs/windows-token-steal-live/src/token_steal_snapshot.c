/*
 * token_steal_snapshot.c — Windows token-steal live lab
 *
 * Simulates a Windows service that manages a process token handle table.
 * Models the token impersonation attack surface (SeImpersonatePrivilege
 * abuse, handle duplication across privilege boundaries).
 *
 * Vulnerability: duplicate_handle() uses a signed comparison on the
 * target index, allowing a negative offset (-1) to alias the SYSTEM
 * token slot when combined with a base-address environment override.
 * The signed/unsigned mismatch is the core of the bug — the table
 * lookup wraps to the SYSTEM entry when target_index + base == 2.
 *
 * Disclosure: --dump-handles flag leaks the privileged token value
 * and mints a proof receipt.
 *
 * Proof chain:
 *   1. Run with --dump-handles → recover token + receipt from log
 *   2. Craft invocation: operation=duplicate, source=user_0,
 *      target_index=-1, env HANDLE_BASE=3 (so -1+3 == SYSTEM slot 2),
 *      plus recovered token and receipt
 *   3. Target validates: duplicate op + resolved slot == SYSTEM +
 *      token match + receipt match → writes proof
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* ── XOR-encoded secret token (key 0x2B) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    's' ^ 0x2B, 'y' ^ 0x2B, 's' ^ 0x2B, 't' ^ 0x2B,
    'e' ^ 0x2B, 'm' ^ 0x2B, '-' ^ 0x2B, 't' ^ 0x2B,
    'o' ^ 0x2B, 'k' ^ 0x2B, 'e' ^ 0x2B, 'n' ^ 0x2B,
    '-' ^ 0x2B, '7' ^ 0x2B, '7' ^ 0x2B
};
#define SECRET_TOKEN_LEN 15
#define XOR_KEY 0x2B

/* ── Token handle table ── */
#define HANDLE_TABLE_SIZE 4

typedef struct {
    char name[32];
    char privilege[16];
    int  active;
} handle_entry_t;

static handle_entry_t handle_table[HANDLE_TABLE_SIZE] = {
    { "user_low",    "low",    1 },
    { "user_medium", "medium", 1 },
    { "SYSTEM",      "system", 1 },
    { "kernel_obj",  "kernel", 0 }
};

/* ── Invocation state ── */
typedef struct {
    char operation[32];       /* "query" or "duplicate" */
    char source_handle[32];   /* e.g. "user_0" */
    int  target_index;        /* signed — the bug */
    int  handle_base;         /* from env HANDLE_BASE, default 0 */
    char supplied_token[64];
    char supplied_receipt[64];
    int  dump_handles;        /* --dump-handles flag */
} invocation_t;

/* ── Write proof artifact ── */
static void write_root_flag(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/proof/root_flag.txt", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "FLAG{windows-token-steal-live}\n");
    fclose(f);
}

/* ── Decode secret token ── */
static void decode_token(char *out) {
    for (int i = 0; i < SECRET_TOKEN_LEN; i++)
        out[i] = SECRET_TOKEN_XOR[i] ^ XOR_KEY;
    out[SECRET_TOKEN_LEN] = '\0';
}

/* ── Mint disclosure receipt ── */
static int mint_receipt(const char *runtime_dir, const char *label) {
    char receipt[32];
    unsigned char randbuf[6];
    char path[512];

    FILE *rng = fopen("/dev/urandom", "rb");
    if (rng) {
        if (fread(randbuf, 1, 6, rng) == 6) {
            snprintf(receipt, sizeof(receipt), "%02x%02x%02x%02x%02x%02x",
                     randbuf[0], randbuf[1], randbuf[2],
                     randbuf[3], randbuf[4], randbuf[5]);
        }
        fclose(rng);
    } else {
        unsigned long fb = 0xA3C1 ^ (unsigned long)label;
        snprintf(receipt, sizeof(receipt), "%012lx", fb);
    }

    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "%s\n", receipt);
    fclose(f);
    return 0;
}

/* ── Load disclosure receipt from prior run ── */
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

/* ── Parse invocation directory ── */
static int load_invocation(const char *inv_dir, invocation_t *state) {
    char path[512];

    memset(state, 0, sizeof(*state));
    state->target_index = 0;
    state->handle_base = 0;

    /* argv.txt */
    snprintf(path, sizeof(path), "%s/argv.txt", inv_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;

    char line[256];
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "--dump-handles") == 0) {
            state->dump_handles = 1;
        } else if (strncmp(line, "--operation=", 12) == 0) {
            strncpy(state->operation, line + 12, sizeof(state->operation) - 1);
        } else if (strncmp(line, "--source=", 9) == 0) {
            strncpy(state->source_handle, line + 9, sizeof(state->source_handle) - 1);
        } else if (strncmp(line, "--target-index=", 15) == 0) {
            state->target_index = atoi(line + 15);
        } else if (strncmp(line, "--token=", 8) == 0) {
            strncpy(state->supplied_token, line + 8, sizeof(state->supplied_token) - 1);
        } else if (strncmp(line, "--receipt=", 10) == 0) {
            strncpy(state->supplied_receipt, line + 10, sizeof(state->supplied_receipt) - 1);
        }
    }
    fclose(f);

    /* env.list */
    snprintf(path, sizeof(path), "%s/env.list", inv_dir);
    f = fopen(path, "r");
    if (f) {
        while (fgets(line, sizeof(line), f)) {
            line[strcspn(line, "\r\n")] = '\0';
            if (strncmp(line, "HANDLE_BASE=", 12) == 0) {
                state->handle_base = atoi(line + 12);
            }
        }
        fclose(f);
    }

    return 0;
}

/* ── Append to runtime log ── */
static void log_msg(const char *runtime_dir, const char *tag,
                     const char *fmt, ...) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/token-steal.log", runtime_dir);
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

/* ── duplicate_handle: the vulnerable function ──
 *
 * Bug: target_index is signed. When handle_base is set via HANDLE_BASE
 * env var, the resolved index is (target_index + handle_base).
 * A negative target_index can wrap into the SYSTEM slot (index 2)
 * if handle_base is chosen so the sum equals 2.
 *
 * Normal callers always pass target_index >= 0 and handle_base == 0,
 * so the signed comparison "resolved < 0" catches negatives.
 * But with HANDLE_BASE=3 and target_index=-1, resolved=2 — SYSTEM.
 */
static int duplicate_handle(invocation_t *state) {
    int resolved = state->target_index + state->handle_base;

    /* "Security check" — only blocks raw negatives */
    if (resolved < 0 || resolved >= HANDLE_TABLE_SIZE)
        return -1;

    /* Check source exists */
    if (strcmp(state->source_handle, "user_0") != 0 &&
        strcmp(state->source_handle, "user_1") != 0)
        return -1;

    return resolved;
}

/* ── main ── */
int main(int argc, char *argv[]) {
    const char *inv_dir = NULL;
    const char *runtime_dir = NULL;

    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--invocation", 12) == 0 && i + 1 < argc)
            inv_dir = argv[++i];
        else if (strncmp(argv[i], "--runtime", 9) == 0 && i + 1 < argc)
            runtime_dir = argv[++i];
    }

    if (!inv_dir || !runtime_dir) {
        fprintf(stderr, "usage: %s --invocation <dir> --runtime <dir>\n",
                argv[0]);
        return 1;
    }

    invocation_t state;
    if (load_invocation(inv_dir, &state) != 0) {
        fprintf(stderr, "failed to load invocation from %s\n", inv_dir);
        return 1;
    }

    log_msg(runtime_dir, "service", "token manager started");

    /* ── Disclosure path ── */
    if (state.dump_handles) {
        char secret[64];
        decode_token(secret);

        log_msg(runtime_dir, "user", "handle dump requested");
        for (int i = 0; i < HANDLE_TABLE_SIZE; i++) {
            log_msg(runtime_dir, "user",
                    "  handle[%d]: name=%s privilege=%s active=%d",
                    i, handle_table[i].name, handle_table[i].privilege,
                    handle_table[i].active);
        }
        log_msg(runtime_dir, "user",
                "privileged token disclosure: %s", secret);

        if (mint_receipt(runtime_dir, "token-steal") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "token-steal",
                                        receipt, sizeof(receipt)) == 0) {
                log_msg(runtime_dir, "user",
                        "proof receipt: %s", receipt);
            }
        }
        log_msg(runtime_dir, "service", "handle dump complete");
        printf("handle dump written to runtime log\n");
        return 0;
    }

    /* ── Operation path ── */
    if (strcmp(state.operation, "duplicate") != 0) {
        log_msg(runtime_dir, "service",
                "operation '%s' is not supported or empty", state.operation);
        printf("no matching operation\n");
        return 0;
    }

    int resolved_slot = duplicate_handle(&state);
    if (resolved_slot < 0) {
        log_msg(runtime_dir, "service", "duplicate_handle rejected");
        printf("duplicate rejected\n");
        return 0;
    }

    log_msg(runtime_dir, "service",
            "duplicate: source=%s resolved_target=%d (%s, %s)",
            state.source_handle, resolved_slot,
            handle_table[resolved_slot].name,
            handle_table[resolved_slot].privilege);

    /* ── Proof gate ── */
    char disclosure_receipt[64] = {0};
    char secret[64];
    decode_token(secret);

    if (load_disclosure_receipt(runtime_dir, "token-steal",
                                disclosure_receipt,
                                sizeof(disclosure_receipt)) == 0 &&
        resolved_slot == 2 &&
        strcmp(handle_table[resolved_slot].privilege, "system") == 0 &&
        strcmp(state.supplied_token, secret) == 0 &&
        strcmp(state.supplied_receipt, disclosure_receipt) == 0) {

        log_msg(runtime_dir, "root",
                "SYSTEM token impersonated via handle confusion");
        write_root_flag(runtime_dir);
        log_msg(runtime_dir, "root",
                "proof artifact written to runtime/proof/root_flag.txt");
        printf("SYSTEM token impersonated — proof written\n");
    } else {
        log_msg(runtime_dir, "service",
                "duplicate completed but proof conditions not met");
        printf("duplicate completed, no proof\n");
    }

    return 0;
}
