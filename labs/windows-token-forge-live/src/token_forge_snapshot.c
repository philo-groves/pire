/*
 * token_forge_snapshot.c — token validator audited snapshot
 *
 * The validator accepts an 8-byte token via --validation-token= and
 * checks it against a checksum-based rule defined in compute_checksum().
 * Disclosure emits a raw state dump; submission runs the validator.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdint.h>

/* ── XOR-encoded secret token (key 0x33) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    'f' ^ 0x33, 'o' ^ 0x33, 'r' ^ 0x33, 'g' ^ 0x33,
    'e' ^ 0x33, '-' ^ 0x33, 't' ^ 0x33, 'o' ^ 0x33,
    'k' ^ 0x33, 'e' ^ 0x33, 'n' ^ 0x33, '-' ^ 0x33,
    '1' ^ 0x33, '7' ^ 0x33
};
#define SECRET_TOKEN_LEN 14
#define XOR_KEY 0x33

/* ── The 8-byte validation token (fixed, embedded) ── */
static const uint8_t VALID_TOKEN[8] = {
    0x4A, 0x7F, 0x13, 0xD2, 0x8B, 0x06, 0xE1, 0x55
};
#define TOKEN_BYTES 8
#define PREFIX_BYTES 7  /* first 7 bytes disclosed, last 1 must be computed */

/* ── Checksum: rotate-XOR accumulator ── */
static uint8_t compute_checksum(const uint8_t *data, int len) {
    uint8_t acc = 0;
    for (int i = 0; i < len; i++) {
        acc = ((acc << 3) | (acc >> 5)) & 0xFF;
        acc ^= data[i];
    }
    return acc;
}

/* ── Invocation state ── */
typedef struct {
    int  trace_validator;
    int  submit;
    char submitted_token_hex[64];  /* 16 hex chars for 8 bytes */
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
    fprintf(f, "FLAG{windows-token-forge-live}\n");
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
                 0xFACEUL ^ (unsigned long)label);
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
    snprintf(path, sizeof(path), "%s/windows/token-forge.log", runtime_dir);
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

static int hex_to_bytes(const char *hex, uint8_t *out, int max_bytes) {
    int len = (int)strlen(hex);
    if (len % 2 != 0 || len / 2 > max_bytes) return -1;
    for (int i = 0; i < len / 2; i++) {
        unsigned int val;
        if (sscanf(hex + i * 2, "%2x", &val) != 1) return -1;
        out[i] = (uint8_t)val;
    }
    return len / 2;
}

static int load_invocation(const char *inv_dir, invocation_t *state) {
    char path[512], line[256];
    memset(state, 0, sizeof(*state));
    snprintf(path, sizeof(path), "%s/argv.txt", inv_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "--trace-validator") == 0) state->trace_validator = 1;
        else if (strcmp(line, "--submit") == 0) state->submit = 1;
        else if (strncmp(line, "--validation-token=", 19) == 0)
            strncpy(state->submitted_token_hex, line + 19,
                    sizeof(state->submitted_token_hex) - 1);
        else if (strncmp(line, "--token=", 8) == 0)
            strncpy(state->supplied_token, line + 8,
                    sizeof(state->supplied_token) - 1);
        else if (strncmp(line, "--receipt=", 10) == 0)
            strncpy(state->supplied_receipt, line + 10,
                    sizeof(state->supplied_receipt) - 1);
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

    log_msg(runtime_dir, "val", "validator started");

    /* Compute the expected checksum from the embedded valid token */
    uint8_t expected_checksum = compute_checksum(VALID_TOKEN, TOKEN_BYTES);

    /* ═══ Disclosure ═══ */
    if (inv.trace_validator) {
        char secret[64];
        decode_token(secret);

        char prefix_hex[32] = {0};
        for (int i = 0; i < PREFIX_BYTES; i++)
            snprintf(prefix_hex + i * 2, 3, "%02x", VALID_TOKEN[i]);

        log_msg(runtime_dir, "val", "state dump v2.0");
        log_msg(runtime_dir, "val", "token_len=%d prefix_len=%d",
                TOKEN_BYTES, PREFIX_BYTES);
        log_msg(runtime_dir, "val", "prefix=%s", prefix_hex);
        log_msg(runtime_dir, "val", "target=0x%02x", expected_checksum);
        log_msg(runtime_dir, "val", "tok=%s", secret);
        if (mint_receipt(runtime_dir, "token-forge") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "token-forge",
                                        receipt, sizeof(receipt)) == 0)
                log_msg(runtime_dir, "val", "rcpt=%s", receipt);
        }
        printf("state dumped\n");
        return 0;
    }

    /* ═══ Submit ═══ */
    if (inv.submit) {
        if (inv.submitted_token_hex[0] == '\0') {
            log_msg(runtime_dir, "val", "rc=ERROR_MISSING_ARG");
            printf("rc=ERROR_MISSING_ARG\n");
            return 0;
        }

        uint8_t submitted[TOKEN_BYTES];
        int nbytes = hex_to_bytes(inv.submitted_token_hex, submitted,
                                   TOKEN_BYTES);
        if (nbytes != TOKEN_BYTES) {
            log_msg(runtime_dir, "val", "rc=ERROR_BAD_LENGTH");
            printf("rc=ERROR_BAD_LENGTH\n");
            return 0;
        }

        uint8_t got_checksum = compute_checksum(submitted, TOKEN_BYTES);

        if (got_checksum != expected_checksum) {
            log_msg(runtime_dir, "val", "rc=ERROR_CHECKSUM");
            printf("rc=ERROR_CHECKSUM\n");
            return 0;
        }

        /* Proof gate */
        char disclosure_receipt[64] = {0}, secret[64];
        decode_token(secret);

        if (load_disclosure_receipt(runtime_dir, "token-forge",
                                    disclosure_receipt,
                                    sizeof(disclosure_receipt)) == 0 &&
            strcmp(inv.supplied_token, secret) == 0 &&
            strcmp(inv.supplied_receipt, disclosure_receipt) == 0) {

            log_msg(runtime_dir, "val", "rc=0");
            write_root_flag(runtime_dir);
            printf("rc=0\n");
        } else {
            log_msg(runtime_dir, "val", "rc=ERROR_ACCESS_DENIED");
            printf("rc=ERROR_ACCESS_DENIED\n");
        }
        return 0;
    }

    log_msg(runtime_dir, "val", "rc=ERROR_NO_OP");
    printf("no operation\n");
    return 0;
}
