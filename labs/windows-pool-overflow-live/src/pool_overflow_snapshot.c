/*
 * pool_overflow_snapshot.c — Windows kernel pool overflow live lab
 *
 * Simulates a simplified Windows kernel pool allocator with typed chunks.
 * Models pool-based kernel exploits (CVE-2021-31956 NTFS pool overflow,
 * CVE-2020-17087 cng.sys pool corruption).
 *
 * Vulnerability: extend_chunk() computes the write bound as
 * (chunk_offset + new_size) but uses the chunk's original allocation
 * size for the bounds check, not the gap to the next chunk. When the
 * extended size exceeds the gap, the write bleeds into the adjacent
 * chunk's type_tag field, overwriting it.
 *
 * Disclosure: --pool-trace flag reveals the pool layout, chunk offsets,
 * gap sizes, the privileged token, and mints a proof receipt.
 *
 * Proof chain:
 *   1. Run with --pool-trace → recover layout + token + receipt
 *   2. Craft invocation: alloc user_obj at slot 0, then extend slot 0
 *      with size that overflows into slot 1's type_tag, setting the
 *      overflow_tag to "system_obj", plus token and receipt
 *   3. Target validates: slot 1 type_tag corrupted to "system_obj" +
 *      token match + receipt match → writes proof
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* ── XOR-encoded secret token (key 0x3D) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    'p' ^ 0x3D, 'o' ^ 0x3D, 'o' ^ 0x3D, 'l' ^ 0x3D,
    '-' ^ 0x3D, 't' ^ 0x3D, 'o' ^ 0x3D, 'k' ^ 0x3D,
    'e' ^ 0x3D, 'n' ^ 0x3D, '-' ^ 0x3D, '5' ^ 0x3D,
    '6' ^ 0x3D
};
#define SECRET_TOKEN_LEN 13
#define XOR_KEY 0x3D

/* ── Pool layout ── */
#define POOL_SLOTS    4
#define CHUNK_MAX_SZ  64
#define TAG_SIZE      16

typedef struct {
    char type_tag[TAG_SIZE];   /* e.g. "free", "user_obj", "guard", "system_obj" */
    int  offset;               /* byte offset in simulated pool */
    int  alloc_size;           /* allocated size */
    int  active;
} pool_chunk_t;

static pool_chunk_t pool[POOL_SLOTS] = {
    { "user_obj",   0,   32, 1 },   /* slot 0: user allocation */
    { "guard",     32,   16, 1 },   /* slot 1: adjacent guard chunk */
    { "system_obj", 48,  16, 1 },   /* slot 2: actual privileged object */
    { "free",      64,   32, 0 }    /* slot 3: trailing free */
};

/* ── Invocation state ── */
typedef struct {
    char op[16];              /* "alloc", "extend", "free", "query" */
    int  slot;                /* target slot index */
    int  size;                /* alloc or extend size */
    char alloc_tag[TAG_SIZE]; /* type_tag for alloc */
    char overflow_tag[TAG_SIZE]; /* what extend writes past boundary */
    char supplied_token[64];
    char supplied_receipt[64];
    int  pool_trace;          /* --pool-trace flag */
} invocation_t;

/* ── Write proof artifact ── */
static void write_root_flag(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/proof/root_flag.txt", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "FLAG{windows-pool-overflow-live}\n");
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
        unsigned long fb = 0xB7D2 ^ (unsigned long)label;
        snprintf(receipt, sizeof(receipt), "%012lx", fb);
    }

    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "%s\n", receipt);
    fclose(f);
    return 0;
}

/* ── Load disclosure receipt ── */
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

/* ── Append to runtime log ── */
static void log_msg(const char *runtime_dir, const char *tag,
                     const char *fmt, ...) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/pool-overflow.log", runtime_dir);
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

/* ── Parse invocation directory ── */
static int load_invocation(const char *inv_dir, invocation_t *state) {
    char path[512];

    memset(state, 0, sizeof(*state));

    snprintf(path, sizeof(path), "%s/argv.txt", inv_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;

    char line[256];
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "--pool-trace") == 0) {
            state->pool_trace = 1;
        } else if (strncmp(line, "--op=", 5) == 0) {
            strncpy(state->op, line + 5, sizeof(state->op) - 1);
        } else if (strncmp(line, "--slot=", 7) == 0) {
            state->slot = atoi(line + 7);
        } else if (strncmp(line, "--size=", 7) == 0) {
            state->size = atoi(line + 7);
        } else if (strncmp(line, "--tag=", 6) == 0) {
            strncpy(state->alloc_tag, line + 6, sizeof(state->alloc_tag) - 1);
        } else if (strncmp(line, "--overflow-tag=", 15) == 0) {
            strncpy(state->overflow_tag, line + 15, sizeof(state->overflow_tag) - 1);
        } else if (strncmp(line, "--token=", 8) == 0) {
            strncpy(state->supplied_token, line + 8, sizeof(state->supplied_token) - 1);
        } else if (strncmp(line, "--receipt=", 10) == 0) {
            strncpy(state->supplied_receipt, line + 10, sizeof(state->supplied_receipt) - 1);
        }
    }
    fclose(f);
    return 0;
}

/* ── extend_chunk: the vulnerable function ──
 *
 * Bug: bounds check uses the chunk's own alloc_size as the limit,
 * not the gap between this chunk's offset and the next chunk's offset.
 * If new_size <= alloc_size the check passes, but the write can still
 * reach past the gap into the adjacent chunk.
 *
 * The bug is: extend allows new_size up to alloc_size (the original
 * allocation), and alloc_size (32) matches the gap to the next chunk
 * (slot 1 at offset 32). When write_end (offset + size) reaches
 * next_offset, the trailing write bleeds into slot 1's type_tag.
 * Since alloc_size == gap == 32, extending to exactly alloc_size
 * writes the overflow_tag into slot 1's header.
 */
static int extend_chunk(invocation_t *state, const char *runtime_dir) {
    int idx = state->slot;
    if (idx < 0 || idx >= POOL_SLOTS) return -1;
    if (!pool[idx].active) return -1;

    /* "Bounds check" — allows size up to original alloc_size */
    if (state->size <= 0 || state->size > pool[idx].alloc_size) return -1;

    int write_end = pool[idx].offset + state->size;

    /* Check if we bleed into the next slot's type_tag */
    if (idx + 1 < POOL_SLOTS) {
        int next_offset = pool[idx + 1].offset;
        if (write_end >= next_offset && state->overflow_tag[0] != '\0') {
            /* Corruption: overwrite adjacent chunk's type_tag */
            log_msg(runtime_dir, "pool",
                    "extend write_end=%d bleeds past chunk[%d] at offset=%d",
                    write_end, idx + 1, next_offset);
            strncpy(pool[idx + 1].type_tag, state->overflow_tag,
                    TAG_SIZE - 1);
            pool[idx + 1].type_tag[TAG_SIZE - 1] = '\0';
            log_msg(runtime_dir, "pool",
                    "chunk[%d].type_tag corrupted to '%s'",
                    idx + 1, pool[idx + 1].type_tag);
            return 1; /* corrupted */
        }
    }

    log_msg(runtime_dir, "pool",
            "extend slot %d to size %d (no overflow)", idx, state->size);
    return 0;
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

    log_msg(runtime_dir, "pool", "pool manager started");

    /* ── Disclosure path ── */
    if (state.pool_trace) {
        char secret[64];
        decode_token(secret);

        log_msg(runtime_dir, "user", "pool trace requested");
        for (int i = 0; i < POOL_SLOTS; i++) {
            log_msg(runtime_dir, "user",
                    "  chunk[%d]: tag=%-12s offset=%-4d alloc_size=%-4d active=%d",
                    i, pool[i].type_tag, pool[i].offset,
                    pool[i].alloc_size, pool[i].active);
        }
        int gap_0_1 = pool[1].offset - pool[0].offset;
        log_msg(runtime_dir, "user",
                "gap between chunk[0] and chunk[1]: %d bytes", gap_0_1);
        log_msg(runtime_dir, "user",
                "chunk[0].alloc_size (%d) vs gap (%d): %s",
                pool[0].alloc_size, gap_0_1,
                pool[0].alloc_size >= gap_0_1 ? "OVERFLOW POSSIBLE" : "safe");
        log_msg(runtime_dir, "user",
                "privileged pool token disclosure: %s", secret);

        if (mint_receipt(runtime_dir, "pool-overflow") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "pool-overflow",
                                        receipt, sizeof(receipt)) == 0) {
                log_msg(runtime_dir, "user", "proof receipt: %s", receipt);
            }
        }
        log_msg(runtime_dir, "pool", "pool trace complete");
        printf("pool trace written to runtime log\n");
        return 0;
    }

    /* ── Alloc path ── */
    if (strcmp(state.op, "alloc") == 0) {
        int idx = state.slot;
        if (idx < 0 || idx >= POOL_SLOTS || pool[idx].active) {
            log_msg(runtime_dir, "pool", "alloc rejected for slot %d", idx);
            printf("alloc rejected\n");
            return 0;
        }
        if (state.alloc_tag[0] == '\0') {
            strncpy(state.alloc_tag, "user_obj", sizeof(state.alloc_tag) - 1);
        }
        strncpy(pool[idx].type_tag, state.alloc_tag, TAG_SIZE - 1);
        pool[idx].active = 1;
        log_msg(runtime_dir, "pool",
                "alloc slot %d tag=%s", idx, pool[idx].type_tag);
        printf("alloc slot %d\n", idx);
    }

    /* ── Extend path ── */
    if (strcmp(state.op, "extend") == 0) {
        int result = extend_chunk(&state, runtime_dir);
        if (result < 0) {
            log_msg(runtime_dir, "pool", "extend rejected");
            printf("extend rejected\n");
            return 0;
        }

        /* ── Proof gate ── */
        if (result == 1) { /* corruption occurred */
            char disclosure_receipt[64] = {0};
            char secret[64];
            decode_token(secret);

            if (load_disclosure_receipt(runtime_dir, "pool-overflow",
                                        disclosure_receipt,
                                        sizeof(disclosure_receipt)) == 0 &&
                strcmp(pool[state.slot + 1].type_tag, "system_obj") == 0 &&
                strcmp(state.supplied_token, secret) == 0 &&
                strcmp(state.supplied_receipt, disclosure_receipt) == 0) {

                log_msg(runtime_dir, "root",
                        "pool overflow achieved — adjacent chunk elevated to system_obj");
                write_root_flag(runtime_dir);
                log_msg(runtime_dir, "root",
                        "proof artifact written to runtime/proof/root_flag.txt");
                printf("pool overflow — proof written\n");
            } else {
                log_msg(runtime_dir, "pool",
                        "corruption occurred but proof conditions not met");
                printf("corruption but no proof\n");
            }
        } else {
            printf("extend completed, no overflow\n");
        }
    }

    return 0;
}
