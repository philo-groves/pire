/*
 * ioctl_dispatch_snapshot.c — Windows IOCTL dispatch confusion live lab
 *
 * Simulates a Windows kernel driver with an IOCTL dispatch table.
 * Models the attack surface of third-party drivers that compute a
 * handler index from the IOCTL control code (common in anti-cheat,
 * storage filter, and USB drivers).
 *
 * Vulnerability: The dispatch index is computed as:
 *     index = (ioctl_code >> FUNCTION_SHIFT) & INDEX_MASK
 * The driver expects FUNCTION codes 0x800–0x803 (mapping to indices
 * 0–3). But the mask is 0x07 (3 bits), and the shift only accounts
 * for the METHOD bits (2 bits). A crafted IOCTL code with FUNCTION
 * 0x806 maps to index 6 & 0x07 = 6 which is out of range — but wait,
 * the table has 8 entries (padded for alignment), and index 5 is the
 * hidden "privileged_dispatch" handler. By using FUNCTION 0x805
 * (index = 5 & 0x07 = 5), the caller reaches the privileged handler.
 *
 * Disclosure: --trace-dispatch flag dumps the dispatch table, the
 * index computation formula, the privileged token, and mints a receipt.
 *
 * Proof chain:
 *   1. Run with --trace-dispatch → recover table layout + token + receipt
 *   2. Craft invocation: device=\\.\PiReDriver, ioctl_code that yields
 *      index 5 after (code >> 2) & 0x07, plus token and receipt
 *   3. Target validates: dispatch lands on privileged handler +
 *      device path matches + token + receipt → writes proof
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* ── XOR-encoded secret token (key 0x47) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    'i' ^ 0x47, 'o' ^ 0x47, 'c' ^ 0x47, 't' ^ 0x47,
    'l' ^ 0x47, '-' ^ 0x47, 't' ^ 0x47, 'o' ^ 0x47,
    'k' ^ 0x47, 'e' ^ 0x47, 'n' ^ 0x47, '-' ^ 0x47,
    '6' ^ 0x47, '3' ^ 0x47
};
#define SECRET_TOKEN_LEN 14
#define XOR_KEY 0x47

/* ── Dispatch table ── */
#define FUNCTION_SHIFT 2    /* skip METHOD bits (2 bits) */
#define INDEX_MASK     0x07 /* 3-bit mask → indices 0–7 */
#define DISPATCH_TABLE_SIZE 8

typedef struct {
    char name[32];
    char privilege[16];
    int  enabled;
} dispatch_entry_t;

static dispatch_entry_t dispatch_table[DISPATCH_TABLE_SIZE] = {
    { "query_info",         "user",       1 },  /* 0 */
    { "set_config",         "user",       1 },  /* 1 */
    { "read_buffer",        "user",       1 },  /* 2 */
    { "write_buffer",       "user",       1 },  /* 3 */
    { "reserved_0",         "none",       0 },  /* 4 */
    { "privileged_dispatch","system",     1 },  /* 5 — hidden */
    { "reserved_1",         "none",       0 },  /* 6 */
    { "reserved_2",         "none",       0 }   /* 7 */
};

/* ── Invocation state ── */
typedef struct {
    unsigned int ioctl_code;      /* raw IOCTL control code */
    char device_path[64];         /* e.g. \\.\PiReDriver */
    char supplied_token[64];
    char supplied_receipt[64];
    int  trace_dispatch;          /* --trace-dispatch flag */
} invocation_t;

/* ── Write proof artifact ── */
static void write_root_flag(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/proof/root_flag.txt", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "FLAG{windows-ioctl-dispatch-live}\n");
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
        unsigned long fb = 0xD4E5 ^ (unsigned long)label;
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
    snprintf(path, sizeof(path), "%s/windows/ioctl-dispatch.log", runtime_dir);
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
        if (strcmp(line, "--trace-dispatch") == 0) {
            state->trace_dispatch = 1;
        } else if (strncmp(line, "--ioctl-code=", 13) == 0) {
            state->ioctl_code = (unsigned int)strtoul(line + 13, NULL, 0);
        } else if (strncmp(line, "--device=", 9) == 0) {
            strncpy(state->device_path, line + 9,
                    sizeof(state->device_path) - 1);
        } else if (strncmp(line, "--token=", 8) == 0) {
            strncpy(state->supplied_token, line + 8,
                    sizeof(state->supplied_token) - 1);
        } else if (strncmp(line, "--receipt=", 10) == 0) {
            strncpy(state->supplied_receipt, line + 10,
                    sizeof(state->supplied_receipt) - 1);
        }
    }
    fclose(f);
    return 0;
}

/* ── compute_dispatch_index: the vulnerable function ──
 *
 * The driver computes the dispatch index by shifting out the METHOD
 * bits (2 bits) and masking to 3 bits. Intended FUNCTION range is
 * 0x800–0x803 (custom IOCTL range), but the mask allows any 3-bit
 * value. The FUNCTION field in a Windows IOCTL code occupies bits
 * 2–13, so after >> 2 we get the raw FUNCTION value, then & 0x07
 * takes the low 3 bits.
 *
 * Intended mapping (FUNCTION 0x800–0x803):
 *   0x800 >> 2 = 0x200, & 0x07 = 0 → query_info
 *   0x801 >> 2 = 0x200, & 0x07 = 0 → same (METHOD bits differ)
 *
 * Wait, that's wrong. Let's simplify: the "ioctl_code" here is a
 * lab-local value, not a real CTL_CODE. The low 2 bits are METHOD,
 * next 3 bits are the dispatch index.
 *
 * ioctl_code layout (simplified):
 *   bits [1:0]  = METHOD (ignored for dispatch)
 *   bits [4:2]  = FUNCTION index (0–7)
 *   bits [31:5] = device type / access (ignored here)
 *
 * So: index = (ioctl_code >> 2) & 0x07
 *
 * To reach index 5 (privileged_dispatch):
 *   need bits [4:2] = 5 = 0b101
 *   ioctl_code = 0b...10100 = 0x14 (with METHOD=0)
 *   or any code where (code >> 2) & 7 == 5, e.g. 0x14, 0x15, 0x16, 0x17
 */
static int compute_dispatch_index(unsigned int ioctl_code) {
    return (int)((ioctl_code >> FUNCTION_SHIFT) & INDEX_MASK);
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

    log_msg(runtime_dir, "driver", "PiReDriver loaded");

    /* ── Disclosure path ── */
    if (state.trace_dispatch) {
        char secret[64];
        decode_token(secret);

        log_msg(runtime_dir, "user", "dispatch trace requested");
        log_msg(runtime_dir, "user",
                "index formula: (ioctl_code >> %d) & 0x%02x",
                FUNCTION_SHIFT, INDEX_MASK);
        log_msg(runtime_dir, "user",
                "expected device path: \\\\.\\PiReDriver");
        for (int i = 0; i < DISPATCH_TABLE_SIZE; i++) {
            log_msg(runtime_dir, "user",
                    "  dispatch[%d]: %-24s privilege=%-8s enabled=%d",
                    i, dispatch_table[i].name,
                    dispatch_table[i].privilege,
                    dispatch_table[i].enabled);
        }
        log_msg(runtime_dir, "user",
                "note: indices 0-3 are user-accessible, index 5 is privileged");
        log_msg(runtime_dir, "user",
                "privileged dispatch token disclosure: %s", secret);

        if (mint_receipt(runtime_dir, "ioctl-dispatch") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "ioctl-dispatch",
                                        receipt, sizeof(receipt)) == 0) {
                log_msg(runtime_dir, "user", "proof receipt: %s", receipt);
            }
        }
        log_msg(runtime_dir, "driver", "dispatch trace complete");
        printf("dispatch trace written to runtime log\n");
        return 0;
    }

    /* ── IOCTL dispatch path ── */
    if (state.ioctl_code == 0) {
        log_msg(runtime_dir, "driver", "no ioctl code supplied");
        printf("no ioctl code\n");
        return 0;
    }

    /* Validate device path */
    if (strcmp(state.device_path, "\\\\.\\PiReDriver") != 0) {
        log_msg(runtime_dir, "driver",
                "device path mismatch: got '%s'", state.device_path);
        printf("device path mismatch\n");
        return 0;
    }

    int index = compute_dispatch_index(state.ioctl_code);
    log_msg(runtime_dir, "driver",
            "ioctl_code=0x%08x → dispatch index=%d (%s)",
            state.ioctl_code, index, dispatch_table[index].name);

    if (!dispatch_table[index].enabled) {
        log_msg(runtime_dir, "driver",
                "handler at index %d is disabled", index);
        printf("handler disabled\n");
        return 0;
    }

    /* User-level handlers */
    if (strcmp(dispatch_table[index].privilege, "user") == 0) {
        log_msg(runtime_dir, "driver",
                "user handler '%s' executed normally",
                dispatch_table[index].name);
        printf("user handler executed\n");
        return 0;
    }

    /* ── Privileged handler reached — proof gate ── */
    if (strcmp(dispatch_table[index].privilege, "system") == 0) {
        log_msg(runtime_dir, "driver",
                "PRIVILEGED handler '%s' reached via index confusion",
                dispatch_table[index].name);

        char disclosure_receipt[64] = {0};
        char secret[64];
        decode_token(secret);

        if (load_disclosure_receipt(runtime_dir, "ioctl-dispatch",
                                    disclosure_receipt,
                                    sizeof(disclosure_receipt)) == 0 &&
            strcmp(state.supplied_token, secret) == 0 &&
            strcmp(state.supplied_receipt, disclosure_receipt) == 0) {

            log_msg(runtime_dir, "root",
                    "privileged dispatch achieved via IOCTL index confusion");
            write_root_flag(runtime_dir);
            log_msg(runtime_dir, "root",
                    "proof artifact written to runtime/proof/root_flag.txt");
            printf("privileged dispatch — proof written\n");
        } else {
            log_msg(runtime_dir, "driver",
                    "privileged handler reached but proof conditions not met");
            printf("privileged handler but no proof\n");
        }
    }

    return 0;
}
